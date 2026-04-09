import { Router, type RequestHandler } from 'express';

interface CreateAuthRouterOptions {
  authMiddleware: RequestHandler;
}

export const createAuthRouter = ({
  authMiddleware
}: CreateAuthRouterOptions): Router => {
  const router = Router();

  router.get('/auth/check', authMiddleware, (_request, response) => {
    response.status(204).end();
  });

  return router;
};
