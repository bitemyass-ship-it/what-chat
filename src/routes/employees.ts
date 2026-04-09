import { Router } from 'express';
import type {
  ChatsRepository,
  EmployeesRepository,
  MessagesRepository
} from '../database/types';
import type { Logger, SessionManager } from '../types/whatsapp';
import { createEmployeesController } from '../controllers/employees-controller';
import { createWhatsappSessionController } from '../controllers/whatsapp-session-controller';

interface CreateEmployeesRouterOptions {
  chats: ChatsRepository;
  employees: EmployeesRepository;
  logger: Logger;
  messages: MessagesRepository;
  sessionManager: SessionManager;
}

export const createEmployeesRouter = ({
  chats,
  employees,
  logger,
  messages,
  sessionManager
}: CreateEmployeesRouterOptions): Router => {
  const controller = createEmployeesController({
    chats,
    employees,
    logger,
    messages,
    sessionManager
  });
  const whatsappSessionController = createWhatsappSessionController({
    employees,
    logger,
    sessionManager
  });
  const router = Router();

  router.get('/employees', controller.list);
  router.get('/employees/:code', controller.getByCode);
  router.get('/employees/:code/chats', controller.getChats);
  router.get('/employees/:code/chats/:chatRecordId/messages', controller.getChatMessages);
  router.get('/employees/:code/health', controller.getHealth);
  router.post('/employees/:code/whatsapp-session', whatsappSessionController.create);
  router.get('/employees/:code/whatsapp-session', whatsappSessionController.get);
  router.post('/employees', controller.create);
  router.patch('/employees/:code', controller.update);
  router.delete('/employees/:code', controller.remove);

  return router;
};
