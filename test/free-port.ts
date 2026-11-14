// A free LiveKit port for tests that start a real livekit-server.
//
// Why: fixed ports collide with anything else on the machine (a running app,
// another test run, the other livekit-server on 7990-7992). LiveKit needs three
// in a row: the HTTP port, port+1 (RTC over TCP) and port+2 (RTC over UDP), so
// this checks all three are free right now.
import { createSocket } from "node:dgram";
import { createServer } from "node:net";

const HOST = "127.0.0.1";

function tcpFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = createServer();
    server.once("error", () => resolve(false));
    server.listen(port, HOST, () => server.close(() => resolve(true)));
  });
}

function udpFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = createSocket("udp4");
    socket.once("error", () => resolve(false));
    socket.bind(port, HOST, () => socket.close(() => resolve(true)));
  });
}

/** A port P with P and P+1 (TCP) and P+2 (UDP) free on 127.0.0.1. */
export async function freeLiveKitPort(): Promise<number> {
  for (let tries = 0; tries < 50; tries++) {
    const port = 20_000 + Math.floor(Math.random() * 40_000);
    if ((await tcpFree(port)) && (await tcpFree(port + 1)) && (await udpFree(port + 2))) return port;
  }
  throw new Error("no free port for LiveKit");
}
