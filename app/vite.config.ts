import { createSocket } from 'node:dgram';
import { networkInterfaces } from 'node:os';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

const SERVER_PORT = 4000;

const PRIVATE_IPV4 = /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/;

/**
 * The local address the OS uses for its default route: the one other devices
 * on the same network can reach. A UDP "connect" picks the route without
 * sending any packets.
 */
function defaultRouteAddress(): Promise<string | null> {
  return new Promise((resolve) => {
    const socket = createSocket('udp4');
    const done = (ip: string | null) => {
      socket.close();
      resolve(ip);
    };
    socket.on('error', () => done(null));
    socket.connect(53, '8.8.8.8', () => {
      try {
        const ip = socket.address().address;
        done(PRIVATE_IPV4.test(ip) ? ip : null);
      } catch {
        done(null);
      }
    });
  });
}

/** Fallback when offline: first private IPv4 on a physical-looking adapter. */
function firstLanAddress(): string | null {
  const virtual = /vethernet|virtual|vmware|vbox|docker|wsl|hyper-v|loopback|tailscale|zerotier|vpn|bluetooth/i;
  for (const [name, addrs] of Object.entries(networkInterfaces())) {
    if (virtual.test(name)) continue;
    for (const a of addrs ?? []) {
      // 192.168.56/99.x are VirtualBox / docker-machine host-only networks.
      if (a.family === 'IPv4' && !a.internal && PRIVATE_IPV4.test(a.address) && !/^192\.168\.(56|99)\./.test(a.address)) {
        return a.address;
      }
    }
  }
  return null;
}

export default defineConfig(async ({ mode, command }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const devServer = env.DEV_PROXY_TARGET || `http://localhost:${SERVER_PORT}`;

  // Building the APK without VITE_SERVER_URL: point it at this PC's Najik server
  // on the LAN, so "build & run on a phone on the same Wi-Fi" needs no setup.
  // (Users can still change the address in-app via ⚙ on the sign-in screen.)
  const define: Record<string, string> = {};
  if (command === 'build' && !env.VITE_SERVER_URL) {
    const ip = (await defaultRouteAddress()) ?? firstLanAddress();
    if (ip) {
      const url = `http://${ip}:${SERVER_PORT}`;
      define['import.meta.env.VITE_SERVER_URL'] = JSON.stringify(url);
      console.log(`\n  ➜ VITE_SERVER_URL not set: the app will connect to ${url} (this PC on your network).`);
      console.log('    Set VITE_SERVER_URL in app/.env.production.local to use another server.\n');
    }
  }

  return {
    plugins: [react(), tailwindcss()],
    define,
    server: {
      host: true,
      port: 5173,
      // In web development the API is proxied so the browser talks to one origin.
      proxy: {
        '/api': { target: devServer, changeOrigin: true },
        '/socket.io': { target: devServer, changeOrigin: true, ws: true },
      },
    },
    build: {
      target: 'es2022',
      sourcemap: false,
      chunkSizeWarningLimit: 900,
    },
  };
});
