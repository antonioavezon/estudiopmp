from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import List, Dict, Optional, Any
import psycopg2
from psycopg2.extras import RealDictCursor
import pika
import json
import os
import time

app = FastAPI(title="PMP Exam API")

# Configuración CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Conexión a Base de Datos con reintentos
def get_db_connection():
    while True:
        try:
            conn = psycopg2.connect(os.getenv("DATABASE_URL"))
            return conn
        except:
            print("Esperando a la DB...")
            time.sleep(2)

# --- MODELOS DE DATOS (Pydantic) ---

class AnswerSubmission(BaseModel):
    question_id: int
    selected_option: str # "A" o "A,B"
    time_taken_ms: int

class ExamSubmission(BaseModel):
    user_id: int
    answers: List[AnswerSubmission]

class QuestionCreate(BaseModel):
    content: str
    options: Dict[str, str]
    correct_option: str
    explanation: str
    domain: str

# --- RABBITMQ PUBLISHER ---
def publish_to_queue(message: dict):
    try:
        params = pika.URLParameters(os.getenv("RABBITMQ_URL"))
        connection = pika.BlockingConnection(params)
        channel = connection.channel()
        channel.queue_declare(queue='exam_analytics')
        channel.basic_publish(exchange='', routing_key='exam_analytics', body=json.dumps(message))
        connection.close()
    except Exception as e:
        print(f"Error RabbitMQ: {e}")

# --- ENDPOINTS ---

# 1. Estadísticas para la pantalla de inicio (Conteo por dominio)
@app.get("/questions/stats")
def get_questions_stats():
    conn = get_db_connection()
    cur = conn.cursor(cursor_factory=RealDictCursor)
    try:
        cur.execute("SELECT domain, COUNT(*) as count FROM questions GROUP BY domain")
        rows = cur.fetchall()
        
        stats = {row['domain']: row['count'] for row in rows}
        stats['total'] = sum(stats.values())
        return stats
    finally:
        conn.close()

# 2. Obtener preguntas aleatorias (con filtros y lógica de selección múltiple)
@app.get("/questions/random")
def get_random_questions(
    limit: int = 15, 
    domains: Optional[List[str]] = Query(None) # Soporta ?domains=Personas&domains=Procesos
):
    conn = get_db_connection()
    cur = conn.cursor(cursor_factory=RealDictCursor)
    
    # Construcción dinámica de la query
    query = "SELECT id, content, options, domain, correct_option FROM questions"
    params = []

    if domains:
        query += " WHERE domain = ANY(%s)"
        params.append(domains)
    
    query += " ORDER BY RANDOM() LIMIT %s"
    params.append(limit)

    cur.execute(query, tuple(params))
    questions = cur.fetchall()
    conn.close()
    
    # Procesamiento post-query
    for q in questions:
        # Calcular si es selección múltiple contando las respuestas correctas
        correct_opts = q['correct_option'].split(',')
        q['selection_limit'] = len(correct_opts)
        
        # SEGURIDAD: Borramos la respuesta correcta antes de enviar al cliente
        del q['correct_option']
        
    return questions

# 3. Carga masiva de preguntas (Admin)
@app.post("/questions/upload")
def upload_questions(questions: List[QuestionCreate]):
    conn = get_db_connection()
    cur = conn.cursor()
    inserted_count = 0
    try:
        for q in questions:
            options_json = json.dumps(q.options)
            # Limpiar espacios en respuestas múltiples: "A, B" -> "A,B"
            clean_correct = ",".join([x.strip() for x in q.correct_option.split(',')])
            
            cur.execute(
                """
                INSERT INTO questions (content, options, correct_option, explanation, domain)
                VALUES (%s, %s, %s, %s, %s)
                """,
                (q.content, options_json, clean_correct, q.explanation, q.domain)
            )
            inserted_count += 1
        conn.commit()
        return {"status": "success", "message": f"Se han importado {inserted_count} preguntas correctamente."}
    except Exception as e:
        conn.rollback()
        raise HTTPException(status_code=500, detail=f"Error al guardar en DB: {str(e)}")
    finally:
        conn.close()

# 4. Enviar examen para corrección
@app.post("/exam/submit")
def submit_exam(submission: ExamSubmission):
    conn = get_db_connection()
    cur = conn.cursor()
    
    # Crear sesión
    cur.execute(
        "INSERT INTO exam_sessions (user_id, status) VALUES (%s, 'PROCESSING') RETURNING id",
        (submission.user_id,)
    )
    exam_id = cur.fetchone()[0]
    
    # Guardar respuestas crudas
    for ans in submission.answers:
        cur.execute(
            """INSERT INTO user_answers (exam_session_id, question_id, selected_option, time_taken_ms) 
               VALUES (%s, %s, %s, %s)""",
            (exam_id, ans.question_id, ans.selected_option, ans.time_taken_ms)
        )
    
    conn.commit()
    conn.close()
    
    # Avisar al worker para análisis pesado
    publish_to_queue({"exam_id": exam_id, "action": "calculate_kpis"})
    
    return {"status": "received", "exam_id": exam_id, "message": "Procesando resultados..."}

# 5. Obtener resultados finales (Polling)
@app.get("/exam/{exam_id}/results")
def get_results(exam_id: int):
    conn = get_db_connection()
    cur = conn.cursor(cursor_factory=RealDictCursor)
    # Incluimos detailed_feedback generado por el worker
    cur.execute("SELECT score, domain_weakness, detailed_feedback, status FROM exam_sessions WHERE id = %s", (exam_id,))
    result = cur.fetchone()
    conn.close()
    
    if not result:
        raise HTTPException(status_code=404, detail="Examen no encontrado")
        
    return result

# 6. NUEVO: Revisión detallada (Pregunta + Respuesta Usuario + Correcta + Explicación)
@app.get("/exam/{exam_id}/review")
def get_exam_review(exam_id: int):
    conn = get_db_connection()
    cur = conn.cursor(cursor_factory=RealDictCursor)
    
    # Verificamos que el examen esté completado
    cur.execute("SELECT status FROM exam_sessions WHERE id = %s", (exam_id,))
    session = cur.fetchone()
    
    if not session or session['status'] != 'COMPLETED':
        conn.close()
        raise HTTPException(status_code=400, detail="El examen aún no está listo para revisión")

    # Hacemos JOIN para traer los textos de las preguntas y las respuestas guardadas
    query = """
        SELECT 
            q.content, 
            q.options, 
            q.correct_option, 
            q.explanation, 
            q.domain, 
            ua.selected_option, 
            ua.is_correct, 
            ua.time_taken_ms
        FROM user_answers ua
        JOIN questions q ON ua.question_id = q.id
        WHERE ua.exam_session_id = %s
        ORDER BY ua.id ASC
    """
    cur.execute(query, (exam_id,))
    review_data = cur.fetchall()
    conn.close()
    
    return review_data