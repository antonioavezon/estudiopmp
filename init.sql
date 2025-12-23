-- Estructura inicial para PostgreSQL

CREATE TABLE users (
    id SERIAL PRIMARY KEY,
    username VARCHAR(50) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE questions (
    id SERIAL PRIMARY KEY,
    external_id VARCHAR(50),
    content TEXT NOT NULL,
    options JSONB NOT NULL,
    correct_option VARCHAR(50) NOT NULL,
    explanation TEXT,
    domain VARCHAR(50),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE exam_sessions (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users(id),
    started_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    completed_at TIMESTAMP,
    score NUMERIC(5, 2),
    domain_weakness JSONB,
    detailed_feedback JSONB, -- NUEVO CAMPO: Para el análisis profundo del worker
    status VARCHAR(20) DEFAULT 'IN_PROGRESS'
);

CREATE TABLE user_answers (
    id SERIAL PRIMARY KEY,
    exam_session_id INTEGER REFERENCES exam_sessions(id),
    question_id INTEGER REFERENCES questions(id),
    selected_option VARCHAR(50),
    is_correct BOOLEAN,
    time_taken_ms INTEGER
);

-- Seed básico
INSERT INTO users (username, password_hash) VALUES ('admin', 'hash_secreto');
INSERT INTO questions (content, options, correct_option, explanation, domain) VALUES 
('¿Cuál es el rol principal del Project Manager?', '{"A": "Codificar", "B": "Integrar", "C": "Vender", "D": "Diseñar"}', 'B', 'El PM es el integrador por excelencia.', 'Personas'),
('En un entorno Ágil, ¿quién prioriza el Backlog?', '{"A": "Scrum Master", "B": "Equipo", "C": "Product Owner", "D": "Cliente"}', 'C', 'El PO maximiza el valor del producto.', 'Procesos');