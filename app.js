/*
 * Entry point.
 *
 * cPanel's "Setup Node.js App" runs this file through Phusion Passenger, which
 * supplies PORT and expects the process to listen on it. Keep this file thin:
 * everything it does is read the port and start the server, so that running it
 * locally with `npm start` and running it under Passenger are the same code
 * path rather than two that drift apart.
 *
 *   npm start        -> http://localhost:5173
 *   cPanel/Passenger -> PORT is injected; the app root is this directory and
 *                       the application startup file is `app.js`
 */

import { createServer } from "./server/index.js";

const PORT = Number(process.env.PORT ?? 5173);
const HOST = process.env.HOST ?? "0.0.0.0";

const app = createServer();

app.listen(PORT, HOST, () => {
  console.log(`\n  Multi-source S/R zone fusion -> http://localhost:${PORT}\n`);
});
