import { registerEndpoint } from '../api-handlers.js';
import { requestInterrupt } from '../../../../prompt/steps/step-iterate/handlers/container-task/commands/interrupt-controller.js';

registerEndpoint((router, service) => {
  router.post('/interrupt-execution', async (req, res) => {
    try {
      const { scope } = req.body;

      if (scope === 'container-command') {
        const result = requestInterrupt();
        if (result.accepted) {
          res.json({ message: 'Interrupt for container command requested successfully' });
        } else {
          res.status(409).json({ error: 'Interrupt already in progress or no command running' });
        }
      } else {
        // Fallback to interrupting the whole iteration
        await service.interruptExecution();
        res.json({ message: 'Execution interrupted successfully' });
      }
    } catch (error) {
      console.error('Error interrupting execution:', error);
      res.status(500).json({ error: 'An error occurred while interrupting execution' });
    }
  });
});
