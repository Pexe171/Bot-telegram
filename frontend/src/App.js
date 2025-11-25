import React from 'react';
import Dashboard from './components/Dashboard';

function App() {
  return (
    <div style={{ backgroundColor: '#000000', color: '#FFFFFF', height: '100vh', padding: '20px', fontFamily: 'Arial, sans-serif' }}>
      <h1>Painel de Controle do Bot Telegram</h1>
      <p>Bem-vindo ao painel de controle. Aqui você pode visualizar status, enviar mensagens personalizadas, agendar mensagens, gerenciar promoções, preços, inscrições e acompanhar as estatísticas do bot.</p>
      <Dashboard />
    </div>
  );
}

export default App;
