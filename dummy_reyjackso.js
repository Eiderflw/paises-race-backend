const io = require('socket.io-client');
const socket = io('http://localhost:3001');

socket.on('connect', () => {
    console.log('Dummy connected! Emitting tiktok:connect for @reyjackso');
    socket.emit('tiktok:connect', { username: 'reyjackso', sessionId: '' });
});

socket.on('tiktok:status', (data) => console.log('STATUS:', data));
socket.on('tiktok:connect:response', (data) => console.log('RESPONSE:', data));

setTimeout(() => {
    console.log('Timeout. Exiting dummy');
    process.exit(0);
}, 10000);
