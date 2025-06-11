const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const fs = require('fs');
const path = require('path');
const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const PORT = process.env.PORT || 3000;
const WORDLIST = fs.readFileSync(path.join(__dirname, 'wortliste.txt'), 'utf-8')
    .split('\n').map(w => w.trim()).filter(Boolean);

let lobbys = {};

function makeCode(len = 6) {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s = '';
  for (let i = 0; i < len; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
}

function chooseImposters(count) {
  let num = Math.min(Math.max(1, Math.floor(count / 4)), 3);
  let res = [];
  while (res.length < num) {
    let i = Math.floor(Math.random() * count);
    if (!res.includes(i)) res.push(i);
  }
  return res;
}

function getRandomWord() {
  return WORDLIST[Math.floor(Math.random() * WORDLIST.length)];
}

wss.on('connection', ws => {
  ws.on('message', msg => {
    try {
      const data = JSON.parse(msg);
      const code = data.code;
      const lobby = lobbys[code];

      if (data.type === 'createLobby') {
        let newCode;
        do { newCode = makeCode(); } while (lobbys[newCode]);
        lobbys[newCode] = {
          players: [], chat: [], state: 'waiting',
          word: '', imposters: [], votes: {}
        };
        ws.send(JSON.stringify({ type: 'lobbyCreated', code: newCode }));
      }

      else if (data.type === 'joinLobby') {
        if (!lobby) return ws.send(JSON.stringify({ type: 'error', message: 'Lobby nicht gefunden.' }));
        if (lobby.players.some(p => p.name === data.name))
          return ws.send(JSON.stringify({ type: 'error', message: 'Name vergeben.' }));
        lobby.players.push({ name: data.name, ws, role: 'waiting' });
        ws.lobby = code; ws.playerName = data.name;
        lobby.players.forEach(p => {
          p.ws.send(JSON.stringify({ type: 'updatePlayers', players: lobby.players.map(x => x.name) }));
        });
      }

      else if (data.type === 'startGame') {
        if (!lobby || lobby.players.length < 4)
          return ws.send(JSON.stringify({ type: 'error', message: 'Mindestens 4 Spieler nötig.' }));
        const word = getRandomWord();
        const imposters = chooseImposters(lobby.players.length);
        lobby.word = word; lobby.imposters = imposters; lobby.state = 'playing';
        lobby.players.forEach((p, i) => {
          if (imposters.includes(i))
            p.role = 'imposter', p.ws.send(JSON.stringify({ type: 'role', role: 'imposter', word: null }));
          else
            p.role = 'normal', p.ws.send(JSON.stringify({ type: 'role', role: 'normal', word }));
        });
        lobby.chat = [];
        lobby.players.forEach(p => p.ws.send(JSON.stringify({ type: 'gameStarted' })));
      }

      else if (data.type === 'chat') {
        if (!lobby) return;
        const message = { name: ws.playerName, text: data.text };
        lobby.chat.push(message);
        lobby.players.forEach(p => p.ws.send(JSON.stringify({ type: 'chat', msg: message })));
      }

      else if (data.type === 'vote') {
        if (!lobby) return;
        lobby.votes[ws.playerName] = data.voted;
        if (Object.keys(lobby.votes).length === lobby.players.length) {
          const tally = {};
          Object.values(lobby.votes).forEach(v => tally[v] = (tally[v]||0) + 1);
          const max = Math.max(...Object.values(tally));
          const votedOut = Object.keys(tally).filter(n => tally[n] === max);
          const imposterNames = lobby.imposters.map(i => lobby.players[i].name);
          lobby.players.forEach(p => {
            p.ws.send(JSON.stringify({ type: 'result', votedOut, imposters: imposterNames }));
          });
          lobby.state = 'waiting'; lobby.votes = {};
        }
      }

    } catch (e) {
      ws.send(JSON.stringify({ type: 'error', message: 'Serverfehler' }));
    }
  });

  ws.on('close', () => {
    if (ws.lobby && lobbys[ws.lobby]) {
      const lobby = lobbys[ws.lobby];
      lobby.players = lobby.players.filter(p => p.ws !== ws);
      if (!lobby.players.length) delete lobbys[ws.lobby];
      else {
        lobby.players.forEach(p => p.ws.send(JSON.stringify({ type: 'updatePlayers', players: lobby.players.map(x => x.name) })));
      }
    }
  });
});

app.use(express.static('public'));
server.listen(PORT, () => console.log(`Server läuft auf Port ${PORT}`));
