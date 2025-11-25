import React, { useEffect, useState } from 'react';

function Dashboard() {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    fetch('http://localhost:4000/users')
      .then((response) => {
        if (!response.ok) {
          throw new Error('Falha ao carregar usuários');
        }
        return response.json();
      })
      .then((data) => {
        setUsers(data);
        setLoading(false);
      })
      .catch((err) => {
        setError(err.message);
        setLoading(false);
      });
  }, []);

  if (loading) return <p>Carregando usuários...</p>;
  if (error) return <p>Erro: {error}</p>;

  return (
    <div>
      <h2>Usuários registrados</h2>
      {users.length === 0 ? (
        <p>Nenhum usuário encontrado.</p>
      ) : (
        <ul>
          {users.map((user) => (
            <li key={user.id}>
              {user.firstName} {user.lastName} (@{user.username}) - Telegram ID: {user.telegramId}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default Dashboard;
