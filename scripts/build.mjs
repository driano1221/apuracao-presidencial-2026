import { cp, mkdir } from 'node:fs/promises';
await mkdir('public', { recursive: true });
await cp('web', 'public', { recursive: true });
console.log('Painel estático preparado para GitHub Pages.');
