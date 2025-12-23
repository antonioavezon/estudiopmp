import React, { useState, useEffect } from 'react';

// Cambia a FALSE cuando tengas Docker corriendo
const USE_MOCK_DATA = false;
const API_URL = "http://localhost:8000";

// --- MOCKS (Para pruebas visuales sin backend) ---
const MOCK_QUESTIONS = [
  { id: 1, domain: "Personas", content: "Pregunta con texto largo A) Opción A B) Opción B mal formateada", options: {"A": "1", "B": "2"}, selection_limit: 1 },
];
const MOCK_STATS = { "Personas": 10, "Procesos": 20, "Entorno Empresarial": 5, "total": 35 };

// --- COMPONENTE HELPER PARA FORMATO DE TEXTO ---
// Busca patrones como " A)" " B)" dentro del texto y fuerza saltos de línea visuales para ordenar la lectura
const FormattedText = ({ text }) => {
  if (!text) return null;
  
  // Regex: Busca un espacio (o inicio) seguido de letra mayúscula A-D y paréntesis de cierre
  // Reemplaza con salto de línea + la letra + paréntesis
  const formatted = text.replace(/(\s)([A-D]\))/g, "\n$2");

  return (
    <div className="whitespace-pre-line leading-relaxed">
      {formatted}
    </div>
  );
};

function App() {
  // Vistas: start, admin, exam, processing, results, review, feedback
  const [view, setView] = useState('start'); 
  
  const [questions, setQuestions] = useState([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [answers, setAnswers] = useState({});
  const [startTime, setStartTime] = useState(null);
  const [results, setResults] = useState(null);
  const [reviewData, setReviewData] = useState([]); // Datos para la revisión pregunta por pregunta
  const [examId, setExamId] = useState(null); // ID para pedir revisión
  const [uploadStatus, setUploadStatus] = useState(null);

  // Estados para la configuración del examen
  const [dbStats, setDbStats] = useState(null); // { Personas: 5, Procesos: 10 ... }
  const [config, setConfig] = useState({
    quantity: 5,
    selectedDomains: [] // ["Personas", "Procesos"]
  });

  // --- HELPER FETCH ---
  const customFetch = async (endpoint, options = {}) => {
    if (USE_MOCK_DATA) {
      return new Promise(resolve => setTimeout(() => {
        if (endpoint.includes('stats')) resolve(MOCK_STATS);
        if (endpoint.includes('random')) resolve(MOCK_QUESTIONS);
        if (endpoint.includes('submit')) resolve({ status: "received", exam_id: 123 });
        if (endpoint.includes('results')) resolve({ 
            score: 85, 
            domain_weakness: {"Procesos": 80}, 
            status: 'COMPLETED',
            detailed_feedback: {
                avg_time_per_question_sec: 45,
                total_time_min: 15,
                best_domain: "Procesos",
                worst_domain: "Personas",
                recommendations: ["Estudiar conflicto"]
            }
        });
        if (endpoint.includes('review')) resolve([
            {content: "Pregunta Mock", selected_option: "A", correct_option: "A", is_correct: true, explanation: "Porque sí"}
        ]);
        if (endpoint.includes('upload')) resolve({ status: "success", message: "Mock upload ok" });
      }, 500));
    }
    
    try {
      const res = await fetch(`${API_URL}${endpoint}`, options);
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.detail || 'Error en la petición');
      }
      return await res.json();
    } catch (error) {
      console.error("Error de red:", error);
      throw error;
    }
  };

  // --- CARGA INICIAL ---
  useEffect(() => {
    if (view === 'start') {
      loadStats();
    }
  }, [view]);

  const loadStats = async () => {
    try {
      const stats = await customFetch('/questions/stats');
      setDbStats(stats);
    } catch (e) {
      console.error("Error cargando estadísticas", e);
      setDbStats(null);
    }
  };

  // --- LÓGICA DE CONFIGURACIÓN ---
  const toggleDomain = (domain) => {
    setConfig(prev => {
      const isSelected = prev.selectedDomains.includes(domain);
      const newDomains = isSelected 
        ? prev.selectedDomains.filter(d => d !== domain)
        : [...prev.selectedDomains, domain];
      
      const maxAvailable = calculateMaxQuestions(newDomains);
      const newQuantity = prev.quantity > maxAvailable ? (maxAvailable > 0 ? maxAvailable : 1) : prev.quantity;

      return { ...prev, selectedDomains: newDomains, quantity: newQuantity };
    });
  };

  const calculateMaxQuestions = (domains) => {
    if (!dbStats) return 0;
    if (domains.length === 0) return 0;
    return domains.reduce((acc, dom) => acc + (dbStats[dom] || 0), 0);
  };

  const handleQuantityChange = (e) => {
    let val = parseInt(e.target.value) || 0;
    const max = calculateMaxQuestions(config.selectedDomains);
    if (val > max) val = max;
    if (val < 1 && max > 0) val = 1;
    setConfig(prev => ({ ...prev, quantity: val }));
  };

  // --- LÓGICA DEL EXAMEN ---
  const startExam = async () => {
    const { quantity, selectedDomains } = config;
    
    if (selectedDomains.length === 0) {
      alert("Por favor selecciona al menos un tema.");
      return;
    }

    try {
      const queryParams = new URLSearchParams();
      queryParams.append('limit', quantity);
      selectedDomains.forEach(d => queryParams.append('domains', d));

      const data = await customFetch(`/questions/random?${queryParams.toString()}`);
      
      if (data && data.length > 0) {
        setQuestions(data);
        setView('exam');
        setCurrentIndex(0);
        setAnswers({});
        setStartTime(Date.now());
      } else {
        alert("No se encontraron preguntas con esos criterios.");
      }
    } catch (e) {
      alert("Error iniciando el examen: " + e.message);
    }
  };

  const handleAnswer = (optionKey) => {
    const timeTaken = Date.now() - startTime;
    const currentQuestion = questions[currentIndex];
    const limit = currentQuestion.selection_limit || 1;
    
    setAnswers(prev => {
      const currentSelection = prev[currentQuestion.id]?.selected || [];
      let newSelection = [];

      if (limit === 1) {
        newSelection = [optionKey];
      } else {
        if (currentSelection.includes(optionKey)) {
          newSelection = currentSelection.filter(k => k !== optionKey);
        } else {
          if (currentSelection.length < limit) {
            newSelection = [...currentSelection, optionKey];
          } else {
            newSelection = currentSelection; // Límite alcanzado
          }
        }
      }
      return { ...prev, [currentQuestion.id]: { selected: newSelection, time_taken_ms: timeTaken } };
    });
  };

  const nextQuestion = () => {
    if (currentIndex < questions.length - 1) {
      setCurrentIndex(currentIndex + 1);
      setStartTime(Date.now());
    } else {
      submitExam();
    }
  };

  const submitExam = async () => {
    const payload = {
      user_id: 1,
      answers: Object.keys(answers).map(qId => {
        const ans = answers[qId];
        return {
          question_id: parseInt(qId),
          selected_option: ans.selected.sort().join(','), 
          time_taken_ms: ans.time_taken_ms
        };
      })
    };

    try {
      const data = await customFetch('/exam/submit', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify(payload)
      });
      setExamId(data.exam_id); // Guardar ID para revisión posterior
      setView('processing');
      checkResults(data.exam_id);
    } catch (e) {
      alert("Error enviando: " + e.message);
      setView('start');
    }
  };

  const checkResults = async (id) => {
    const interval = setInterval(async () => {
      try {
        const data = await customFetch(`/exam/${id}/results`);
        if (data && data.status === 'COMPLETED') {
          clearInterval(interval);
          setResults(data);
          setView('results');
        }
      } catch (e) { console.error(e); }
    }, 2000);
  };

  // --- LÓGICA DE REVISIÓN Y FEEDBACK ---
  const loadReview = async () => {
    try {
        const data = await customFetch(`/exam/${examId}/review`);
        setReviewData(data);
        setView('review');
    } catch (e) {
        alert("Error cargando revisión: " + e.message);
    }
  };

  // --- LÓGICA ADMIN ---
  const handleFileUpload = (event) => {
    const file = event.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async (e) => {
      try {
        const json = JSON.parse(e.target.result);
        setUploadStatus("Enviando...");
        const res = await customFetch('/questions/upload', {
          method: 'POST',
          headers: {'Content-Type': 'application/json'},
          body: JSON.stringify(json)
        });
        setUploadStatus(res.status === 'success' ? `✅ ${res.message}` : "Error");
        loadStats();
      } catch (err) {
        setUploadStatus("Error: Archivo no válido");
      }
    };
    reader.readAsText(file);
  };

  // --- VISTAS ---

  if (view === 'start') {
    const maxQuestions = calculateMaxQuestions(config.selectedDomains);
    const availableDomains = dbStats ? Object.keys(dbStats).filter(k => k !== 'total') : [];

    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-slate-50 p-6">
        <div className="bg-white p-8 rounded-2xl shadow-xl w-full max-w-2xl">
          <h1 className="text-4xl font-extrabold mb-2 text-slate-800 text-center">
            Simulador <span className="text-blue-600">PMP</span>
          </h1>
          <p className="text-slate-500 mb-8 text-center">Configura tu sesión de práctica</p>
          
          {!dbStats ? (
            <div className="text-center py-10 text-slate-400">
              {USE_MOCK_DATA ? "Cargando Mock..." : "Conectando con base de datos..."}
              <br/><span className="text-xs">Asegúrate que el backend esté corriendo</span>
            </div>
          ) : (
            <div className="space-y-8">
              {/* Selector de Dominios */}
              <div>
                <h3 className="text-sm font-bold text-slate-700 uppercase tracking-wide mb-3">
                  1. Selecciona Temas <span className="text-red-500">*</span>
                </h3>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  {availableDomains.map(dom => {
                    const count = dbStats[dom];
                    const isSelected = config.selectedDomains.includes(dom);
                    return (
                      <button
                        key={dom}
                        onClick={() => toggleDomain(dom)}
                        disabled={count === 0}
                        className={`p-3 rounded-lg border-2 text-left transition-all ${
                          isSelected 
                            ? 'border-blue-500 bg-blue-50 text-blue-800 ring-1 ring-blue-500' 
                            : 'border-slate-200 hover:border-blue-300 text-slate-600 hover:bg-slate-50'
                        } ${count === 0 ? 'opacity-50 cursor-not-allowed bg-slate-100' : ''}`}
                      >
                        <div className="font-bold text-sm">{dom}</div>
                        <div className="text-xs opacity-70 font-mono mt-1">{count} pregs</div>
                      </button>
                    )
                  })}
                </div>
                {availableDomains.length === 0 && <div className="text-sm text-amber-600 bg-amber-50 p-3 rounded">No hay preguntas cargadas. Ve a configuración.</div>}
              </div>

              {/* Selector de Cantidad */}
              <div className={config.selectedDomains.length === 0 ? "opacity-50 pointer-events-none" : ""}>
                <h3 className="text-sm font-bold text-slate-700 uppercase tracking-wide mb-3">
                  2. Cantidad de Preguntas
                </h3>
                <div className="flex items-center gap-6 bg-slate-50 p-4 rounded-xl border border-slate-200">
                  <input 
                    type="range" 
                    min="1" 
                    max={maxQuestions || 1} 
                    value={config.quantity} 
                    onChange={handleQuantityChange}
                    disabled={maxQuestions === 0}
                    className="w-full h-2 bg-slate-300 rounded-lg appearance-none cursor-pointer accent-blue-600"
                  />
                  <div className="w-24 text-center shrink-0">
                    <span className="text-3xl font-bold text-blue-600 block leading-none">{config.quantity}</span>
                    <span className="text-xs text-slate-400 font-medium">de {maxQuestions} disponibles</span>
                  </div>
                </div>
              </div>

              {/* Botones de Acción */}
              <div className="flex flex-col sm:flex-row gap-4 pt-6 border-t border-slate-100">
                <button 
                  onClick={startExam} 
                  disabled={maxQuestions === 0 || config.selectedDomains.length === 0}
                  className="flex-1 bg-blue-600 hover:bg-blue-700 disabled:bg-slate-300 disabled:cursor-not-allowed text-white font-bold py-4 px-6 rounded-xl shadow-lg hover:shadow-blue-500/30 transition transform hover:-translate-y-1"
                >
                  ▶ Iniciar Examen
                </button>
                <button 
                  onClick={() => { setView('admin'); setUploadStatus(null); }} 
                  className="bg-white hover:bg-gray-50 text-slate-600 font-bold py-4 px-6 rounded-xl border-2 border-slate-200 transition hover:border-slate-300"
                >
                  ⚙ Cargar Datos
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    );
  }

  // --- VISTA EXAMEN ---
  if (view === 'exam') {
    const question = questions[currentIndex];
    if (!question) return <div className="min-h-screen flex items-center justify-center text-slate-400">Cargando...</div>;
    
    const currentSelections = answers[question.id]?.selected || [];
    const limit = question.selection_limit || 1;
    const isMaxReached = currentSelections.length >= limit;

    return (
      <div className="min-h-screen bg-slate-100 py-8 px-4 flex justify-center">
        <div className="w-full max-w-3xl flex flex-col h-full">
          {/* Header Tarjeta */}
          <div className="bg-white rounded-t-2xl p-6 shadow-sm border-b border-slate-100 flex justify-between items-start">
            <div>
              <div className="text-xs font-bold text-blue-600 uppercase tracking-wider mb-1">Pregunta {currentIndex + 1} de {questions.length}</div>
              <div className="flex flex-wrap gap-2 items-center">
                <span className="bg-slate-100 text-slate-600 text-xs px-2 py-1 rounded font-medium border border-slate-200">{question.domain}</span>
                {limit > 1 && (
                  <span className="bg-amber-100 text-amber-800 text-xs px-2 py-1 rounded font-bold border border-amber-200 animate-pulse">
                    Selecciona {limit} opciones
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* Cuerpo Tarjeta */}
          <div className="bg-white rounded-b-2xl p-6 sm:p-10 shadow-xl flex-grow flex flex-col">
            <div className="text-xl sm:text-2xl font-medium text-slate-800 mb-8">
              {/* Uso del componente FormattedText para mejorar legibilidad */}
              <FormattedText text={question.content} />
            </div>
            
            <div className="space-y-3 flex-grow">
              {Object.entries(question.options).map(([key, text]) => {
                const isSelected = currentSelections.includes(key);
                const isDisabledStyle = !isSelected && isMaxReached && limit > 1;

                return (
                  <button
                    key={key}
                    onClick={() => handleAnswer(key)}
                    className={`w-full text-left p-4 sm:p-5 rounded-xl border-2 transition-all duration-200 flex items-start gap-4 group
                      ${isSelected 
                        ? 'border-blue-500 bg-blue-50 shadow-md ring-1 ring-blue-500' 
                        : isDisabledStyle
                          ? 'border-slate-100 bg-slate-50 opacity-60 cursor-not-allowed'
                          : 'border-slate-200 hover:border-blue-300 hover:bg-slate-50'
                      }
                    `}
                  >
                    <div className={`flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold transition-colors
                      ${isSelected ? 'bg-blue-600 text-white' : 'bg-slate-200 text-slate-500 group-hover:bg-blue-100 group-hover:text-blue-600'}
                    `}>
                      {key}
                    </div>
                    <span className={`text-base sm:text-lg ${isSelected ? 'text-blue-900 font-medium' : 'text-slate-600'}`}>
                      {text}
                    </span>
                  </button>
                )
              })}
            </div>

            <div className="mt-10 pt-6 border-t border-slate-100 flex justify-between items-center">
              <span className="text-sm text-slate-400 italic font-medium">
                {limit > 1 ? `Seleccionadas: ${currentSelections.length} / ${limit}` : "Selección única"}
              </span>
              <button 
                onClick={nextQuestion}
                disabled={currentSelections.length === 0 || (limit > 1 && currentSelections.length < limit)}
                className="bg-blue-600 hover:bg-blue-700 text-white px-8 py-3 rounded-lg font-bold shadow-lg disabled:opacity-50 disabled:shadow-none disabled:cursor-not-allowed transition-all transform active:scale-95"
              >
                {currentIndex === questions.length - 1 ? 'Finalizar' : 'Siguiente'}
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // --- VISTA ADMIN (Carga) ---
  if (view === 'admin') {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-slate-100 p-4">
        <div className="bg-white p-8 rounded-2xl shadow-xl max-w-md w-full border border-gray-100">
          <h2 className="text-2xl font-bold mb-2 text-slate-800">Cargar Preguntas</h2>
          <p className="text-sm text-slate-500 mb-6">Sube tu archivo JSON con formato estándar.</p>
          <label className="block w-full cursor-pointer group">
            <input type="file" accept=".json" onChange={handleFileUpload} className="hidden" />
            <div className="flex flex-col items-center justify-center w-full h-32 border-2 border-dashed border-blue-300 rounded-xl bg-blue-50 group-hover:bg-blue-100 transition-colors">
              <span className="text-blue-600 font-medium group-hover:underline">Click para subir JSON</span>
            </div>
          </label>
          {uploadStatus && (
            <div className={`mt-6 p-4 rounded-lg text-sm font-medium ${
              uploadStatus.includes('Error') ? 'bg-red-50 text-red-700 border border-red-100' : 
              'bg-green-50 text-green-700 border border-green-100'
            }`}>
              {uploadStatus}
            </div>
          )}
          <button onClick={() => setView('start')} className="mt-8 w-full py-3 text-slate-500 font-semibold hover:text-slate-800 transition">
            Cancelar / Volver
          </button>
        </div>
      </div>
    );
  }

  if (view === 'processing') {
    return (
      <div className="flex flex-col items-center justify-center h-screen bg-slate-50">
        <div className="w-16 h-16 border-4 border-blue-200 border-t-blue-600 rounded-full animate-spin mb-6"></div>
        <h2 className="text-2xl font-bold text-slate-800">Calculando Resultados</h2>
        <p className="text-slate-500 mt-2">Analizando desempeño...</p>
      </div>
    );
  }

  // --- VISTA RESULTADOS ---
  if (view === 'results') {
    return (
      <div className="min-h-screen bg-slate-100 py-10 px-4 flex justify-center items-start">
        <div className="bg-white p-8 rounded-2xl shadow-xl w-full max-w-lg mt-8 text-center">
          <h2 className="text-3xl font-bold mb-4 text-gray-800">Resultados</h2>
          
          <div className="relative inline-flex items-center justify-center mb-10">
            <svg className="w-48 h-48 transform -rotate-90">
              <circle cx="96" cy="96" r="88" stroke="currentColor" strokeWidth="12" fill="transparent" className="text-slate-100" />
              <circle cx="96" cy="96" r="88" stroke="currentColor" strokeWidth="12" fill="transparent" 
                strokeDasharray={552} 
                strokeDashoffset={552 - (552 * results.score) / 100} 
                strokeLinecap="round"
                className={results.score >= 70 ? "text-emerald-500" : "text-rose-500"} 
              />
            </svg>
            <div className="absolute flex flex-col items-center">
              <span className={`text-5xl font-extrabold ${results.score >= 70 ? "text-emerald-600" : "text-rose-600"}`}>
                {parseFloat(results.score).toFixed(0)}%
              </span>
              <span className="text-xs font-bold text-slate-400 uppercase mt-1">Puntaje Global</span>
            </div>
          </div>
          
          <div className="grid grid-cols-1 gap-4 mb-8">
            <button onClick={loadReview} className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-3 px-4 rounded-lg shadow transition">
              📝 Revisar Respuestas (Detalle)
            </button>
            <button onClick={() => setView('feedback')} className="w-full bg-purple-600 hover:bg-purple-700 text-white font-bold py-3 px-4 rounded-lg shadow transition">
              🧠 Revisar Feedback (Análisis)
            </button>
          </div>
          
          <button onClick={() => setView('start')} className="text-slate-500 font-semibold underline hover:text-slate-700">
            Salir y Volver al Inicio
          </button>
        </div>
      </div>
    );
  }

  // --- VISTA FEEDBACK (Análisis Profundo) ---
  if (view === 'feedback') {
    // Si no hay detailed_feedback, mostramos un aviso
    const fb = results.detailed_feedback || { 
        avg_time_per_question_sec: 0, best_domain: "N/A", recommendations: ["Sin datos suficientes"] 
    };

    return (
      <div className="min-h-screen bg-slate-100 py-10 px-4 flex justify-center items-start">
        <div className="bg-white p-8 rounded-2xl shadow-xl w-full max-w-2xl mt-8">
          <h2 className="text-2xl font-bold text-slate-800 mb-6 border-b pb-4">Análisis de Desempeño</h2>
          
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-8">
            <div className="bg-blue-50 p-5 rounded-xl border border-blue-100">
              <div className="text-xs text-blue-600 font-bold uppercase tracking-wider mb-1">Tiempo Promedio</div>
              <div className="text-3xl font-extrabold text-slate-800">{fb.avg_time_per_question_sec} <span className="text-lg font-normal text-slate-500">seg/preg</span></div>
            </div>
            <div className="bg-green-50 p-5 rounded-xl border border-green-100">
              <div className="text-xs text-green-600 font-bold uppercase tracking-wider mb-1">Mejor Dominio</div>
              <div className="text-lg font-bold text-slate-800 truncate">{fb.best_domain}</div>
            </div>
          </div>

          <div className="mb-8">
            <h3 className="font-bold text-slate-700 mb-3 uppercase text-sm tracking-wide">Recomendaciones de Estudio</h3>
            {fb.recommendations.length > 0 ? (
                <ul className="space-y-2">
                {fb.recommendations.map((rec, i) => (
                    <li key={i} className="bg-yellow-50 p-3 rounded-lg border border-yellow-100 text-slate-700 text-sm flex items-start gap-2">
                        <span className="text-yellow-500 mt-0.5">💡</span> {rec}
                    </li>
                ))}
                </ul>
            ) : (
                <div className="text-sm text-slate-500 italic">No hay recomendaciones específicas. ¡Buen trabajo!</div>
            )}
          </div>

          <button onClick={() => setView('results')} className="text-blue-600 font-bold hover:underline">
            ← Volver a Resultados
          </button>
        </div>
      </div>
    );
  }

  // --- VISTA REVISIÓN (Pregunta a Pregunta) ---
  if (view === 'review') {
    return (
      <div className="min-h-screen bg-slate-100 py-10 px-4">
        <div className="max-w-3xl mx-auto space-y-6">
          <div className="flex justify-between items-center bg-white p-4 rounded-xl shadow-sm">
            <h2 className="text-xl font-bold text-slate-800">Revisión Detallada</h2>
            <button onClick={() => setView('results')} className="bg-slate-700 hover:bg-slate-800 text-white px-4 py-2 rounded-lg font-bold text-sm">
              Cerrar
            </button>
          </div>

          {reviewData.map((item, idx) => (
            <div key={idx} className={`bg-white p-6 rounded-xl shadow border-l-8 ${item.is_correct ? 'border-green-500' : 'border-red-500'}`}>
              <div className="flex justify-between mb-4 items-center">
                <span className="font-bold text-slate-400 text-sm uppercase">Pregunta {idx + 1}</span>
                <span className={`px-3 py-1 rounded-full text-xs font-bold text-white ${item.is_correct ? 'bg-green-500' : 'bg-red-500'}`}>
                  {item.is_correct ? "CORRECTA" : "INCORRECTA"}
                </span>
              </div>
              
              <div className="mb-6 text-lg font-medium text-slate-800 border-b border-slate-100 pb-4">
                <FormattedText text={item.content} />
              </div>
              
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-6 text-sm">
                <div className={`p-4 rounded-lg border ${item.is_correct ? 'bg-green-50 border-green-200' : 'bg-red-50 border-red-200'}`}>
                  <div className="font-bold text-slate-500 mb-1 uppercase text-xs">Tu Respuesta</div>
                  <div className={`text-lg font-bold ${item.is_correct ? "text-green-700" : "text-red-700"}`}>
                    {item.selected_option || "Sin responder"}
                  </div>
                </div>
                <div className="bg-blue-50 p-4 rounded-lg border border-blue-100">
                  <div className="font-bold text-slate-500 mb-1 uppercase text-xs">Respuesta Correcta</div>
                  <div className="text-lg font-bold text-blue-700">{item.correct_option}</div>
                </div>
              </div>

              <div className="bg-slate-50 p-5 rounded-lg text-slate-700 text-sm border border-slate-200">
                <span className="font-bold block mb-2 text-slate-500 uppercase text-xs">Explicación</span>
                <div className="leading-relaxed">{item.explanation}</div>
              </div>
            </div>
          ))}
          
          <div className="flex justify-center pt-6">
            <button onClick={() => setView('results')} className="text-slate-500 font-bold hover:text-slate-800 underline">
                Volver a Resultados
            </button>
          </div>
        </div>
      </div>
    );
  }
}

export default App;