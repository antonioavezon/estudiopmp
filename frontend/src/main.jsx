import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'

// Este archivo es el "pegamento".
// Busca el <div id="root"> en el HTML e inyecta el componente <App /> dentro.

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)