import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import fs from 'fs'
import path from 'path'

// https://vitejs.dev/config/
export default defineConfig({
  base: '/bot/',
  build: {
    outDir: '../dist/dashboard',
    emptyOutDir: true,
  },
  plugins: [
    react(),
    {
      name: 'serve-log',
      configureServer(server) {
        server.middlewares.use('/rebalancer.log', (req, res) => {
          const logPath = path.resolve(__dirname, '../rebalancer.log');
          if (fs.existsSync(logPath)) {
            const content = fs.readFileSync(logPath, 'utf-8');
            res.setHeader('Content-Type', 'text/plain; charset=utf-8');
            res.end(content);
          } else {
            res.statusCode = 404;
            res.end('Log not found');
          }
        });
      }
    }
  ],
})
