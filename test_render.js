const io = require('socket.io-client');
const socket = io('https://paises-race-backend.onrender.com', { transports: ['websocket', 'polling'] });

socket.on('connect_error', (err) => console.log('ERROR:', err.message));

socket.on('connect', () => {
    console.log('Connected to Render! Emitting request for @reyjackso');
    socket.emit('tiktok:connect', { username: 'reyjackso', sessionId: '' });
});

socket.on('tiktok:status', (data) => console.log('STATUS:', data));
socket.on('tiktok:connect:response', (data) => console.log('RESPONSE:', data));

setTimeout(() => {
    console.log('Timeout. Exiting dummy');
    process.exit(0);
}, 10000);
