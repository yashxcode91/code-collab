import express, { Application } from 'express';
import cors from 'cors';
import { healthRouter } from './modules/health/health.router';

export const app: Application = express();

// Standard middleware
app.use(cors());
app.use(express.json());

// Feature routes
app.use('/api/health', healthRouter);