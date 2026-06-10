import { Router } from 'express';
import { health } from '../controllers/health.controller';

const router = Router();
// Public — no auth (penetration-testing readiness, Module 15 §11).
router.get('/', health);

export default router;
