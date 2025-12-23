import pika
import psycopg2
from psycopg2.extras import RealDictCursor
import json
import os
import time

# Esperar a que RabbitMQ y Postgres arranquen por completo
time.sleep(10) 

def get_db_connection():
    return psycopg2.connect(os.getenv("DATABASE_URL"))

def process_exam(ch, method, properties, body):
    data = json.loads(body)
    exam_id = data.get('exam_id')
    print(f" [x] Procesando Examen ID: {exam_id}")

    conn = get_db_connection()
    cur = conn.cursor(cursor_factory=RealDictCursor)

    try:
        # 1. Obtener respuestas del usuario junto con la respuesta correcta de la pregunta
        cur.execute("""
            SELECT a.id as answer_id, a.selected_option, q.correct_option, q.domain, a.time_taken_ms
            FROM user_answers a
            JOIN questions q ON a.question_id = q.id
            WHERE a.exam_session_id = %s
        """, (exam_id,))
        
        answers = cur.fetchall()
        
        if not answers:
            print(f" [!] No se encontraron respuestas para el examen {exam_id}")
            return

        # 2. Análisis de Datos
        total_questions = len(answers)
        correct_count = 0
        domain_stats = {} 
        total_time_ms = 0

        for ans in answers:
            # Comparación robusta (Set vs Set) para manejar "A,B" vs "B,A"
            # Manejo de casos donde selected_option pueda ser None o vacio
            sel_str = ans['selected_option'] if ans['selected_option'] else ""
            corr_str = ans['correct_option'] if ans['correct_option'] else ""
            
            sel_set = set(x.strip() for x in sel_str.split(',') if x.strip())
            corr_set = set(x.strip() for x in corr_str.split(',') if x.strip())
            
            is_correct = (sel_set == corr_set)
            
            # Actualizar si fue correcta en la DB (Corrección asíncrona)
            cur.execute("UPDATE user_answers SET is_correct = %s WHERE id = %s", (is_correct, ans['answer_id']))
            
            if is_correct:
                correct_count += 1
            
            # Estadísticas de Tiempo
            time_ms = ans['time_taken_ms'] if ans['time_taken_ms'] else 0
            total_time_ms += time_ms

            # Estadísticas de Dominio
            domain = ans['domain']
            if domain not in domain_stats:
                domain_stats[domain] = {"correct": 0, "total": 0, "time_sum": 0}
            
            domain_stats[domain]["total"] += 1
            domain_stats[domain]["time_sum"] += time_ms
            
            if is_correct:
                domain_stats[domain]["correct"] += 1

        # 3. Cálculo de KPIs Avanzados
        final_score = (correct_count / total_questions) * 100 if total_questions > 0 else 0
        avg_time_sec = (total_time_ms / total_questions) / 1000 if total_questions > 0 else 0
        
        # KPIs por Dominio y Recomendaciones
        domain_weakness = {}
        best_domain = {"name": "N/A", "score": -1}
        worst_domain = {"name": "N/A", "score": 101}
        recommendations = []

        for dom, stats in domain_stats.items():
            if stats["total"] > 0:
                score_pct = (stats["correct"] / stats["total"]) * 100
            else:
                score_pct = 0
            
            domain_weakness[dom] = round(score_pct, 2)
            
            # Identificar mejor y peor dominio
            if score_pct > best_domain["score"]:
                best_domain = {"name": dom, "score": score_pct}
            
            if score_pct < worst_domain["score"]:
                worst_domain = {"name": dom, "score": score_pct}
                
            # Generar recomendación si el score es bajo
            if score_pct < 70:
                recommendations.append(f"Reforzar: {dom} ({round(score_pct)}% aciertos)")

        if not recommendations:
            recommendations.append("¡Excelente desempeño! Sigue practicando para mantener el nivel.")

        # Construir el objeto de Feedback Detallado (JSON)
        detailed_feedback = {
            "avg_time_per_question_sec": round(avg_time_sec, 2),
            "total_time_min": round((total_time_ms / 1000) / 60, 2),
            "best_domain": f"{best_domain['name']} ({round(best_domain['score'])}%)",
            "worst_domain": f"{worst_domain['name']} ({round(worst_domain['score'])}%)",
            "recommendations": recommendations
        }

        # 4. Guardar resultados finales en la sesión del examen
        cur.execute("""
            UPDATE exam_sessions 
            SET score = %s, domain_weakness = %s, detailed_feedback = %s, completed_at = NOW(), status = 'COMPLETED'
            WHERE id = %s
        """, (final_score, json.dumps(domain_weakness), json.dumps(detailed_feedback), exam_id))
        
        conn.commit()
        print(f" [x] Examen {exam_id} finalizado. Score: {final_score}")

    except Exception as e:
        print(f" [!] Error procesando examen {exam_id}: {str(e)}")
        if conn:
            conn.rollback()
    finally:
        if conn:
            conn.close()

def main():
    # Bucle de reintento para conexión a RabbitMQ
    while True:
        try:
            params = pika.URLParameters(os.getenv("RABBITMQ_URL"))
            connection = pika.BlockingConnection(params)
            channel = connection.channel()
            channel.queue_declare(queue='exam_analytics')

            # Configurar el consumidor
            channel.basic_consume(queue='exam_analytics', on_message_callback=process_exam, auto_ack=True)

            print(' [*] Worker de Analítica iniciado y esperando mensajes...')
            channel.start_consuming()
        except pika.exceptions.AMQPConnectionError:
            print(" [!] No se pudo conectar a RabbitMQ. Reintentando en 5 segundos...")
            time.sleep(5)
        except Exception as e:
            print(f" [!] Error inesperado: {e}")
            time.sleep(5)

if __name__ == '__main__':
    main()