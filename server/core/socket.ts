/**
 * Socket.IO manager for real-time workflow and heartbeat events.
 */
import type { Server as HTTPServer } from 'http';
import { Server as SocketIOServer } from 'socket.io';

import type { HeartbeatStatus } from './heartbeat.js';

let io: SocketIOServer | null = null;

export type AgentEvent =
  | { type: 'stage_change'; workflowId: string; stage: string }
  | { type: 'agent_active'; agentId: string; action: string; workflowId?: string }
  | {
      type: 'message_sent';
      workflowId: string;
      from: string;
      to: string;
      stage: string;
      preview: string;
      timestamp: string;
    }
  | { type: 'score_assigned'; workflowId: string; taskId: number; workerId: string; score: number }
  | { type: 'task_update'; workflowId: string; taskId: number; workerId: string; status: string }
  | { type: 'workflow_complete'; workflowId: string; summary: string }
  | { type: 'workflow_error'; workflowId: string; error: string }
  | { type: 'heartbeat_status'; status: HeartbeatStatus }
  | {
      type: 'heartbeat_report_saved';
      agentId: string;
      reportId: string;
      title: string;
      generatedAt: string;
      summary: string;
      jsonPath: string;
      markdownPath: string;
    };

export function initSocketIO(httpServer: HTTPServer): SocketIOServer {
  io = new SocketIOServer(httpServer, {
    cors: {
      origin: '*',
      methods: ['GET', 'POST'],
    },
    transports: ['websocket', 'polling'],
  });

  io.on('connection', (socket) => {
    console.log(`[Socket] Client connected: ${socket.id}`);

    socket.on('disconnect', () => {
      console.log(`[Socket] Client disconnected: ${socket.id}`);
    });
  });

  console.log('[Socket] Socket.IO initialized');
  return io;
}

export function getSocketIO(): SocketIOServer | null {
  return io;
}

export function emitEvent(event: AgentEvent): void {
  if (io) {
    io.emit('agent_event', event);
  }
}
