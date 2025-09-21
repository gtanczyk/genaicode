import multer from 'multer';
import { CodegenOptions } from '../../../codegen-types.js';
import { registerEndpoint } from '../api-handlers.js';
import { validateCodegenOptions } from '../api-utils.js';
import { ImageData } from '../service.js'; // Import ImageData type

const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB
const MAX_IMAGES = 5;

const storage = multer.memoryStorage();
const upload = multer({
  storage: storage,
  limits: {
    fileSize: MAX_FILE_SIZE,
    files: MAX_IMAGES,
  },
});

registerEndpoint((router, service) => {
  // Get current question
  router.get('/current-question', async (_, res) => {
    try {
      const question = await service.getCurrentQuestion();
      res.json({ question });
    } catch (error) {
      console.error('Error getting current question:', error);
      res.status(500).json({ error: 'An error occurred while getting current question' });
    }
  });

  // Answer question
  // Use multer middleware to handle up to 5 images attached to the 'images' field
  router.post('/answer-question', upload.array('images', 5), async (req, res) => {
    try {
      // Extract text fields from req.body§§
      const { questionId, answer, selectedActionType } = req.body;
      // Handle potential boolean/undefined conversion from FormData string
      const confirmed = req.body.confirmed ? req.body.confirmed === 'true' : undefined;
      // Parse options if present
      const options = req.body.options ? JSON.parse(req.body.options) : undefined;

      // Access uploaded files via req.files
      const files = req.files as Express.Multer.File[];

      // Prepare image data if files exist
      let images: ImageData[] | undefined;
      if (files && files.length > 0) {
        images = files.map((file) => ({
          buffer: file.buffer,
          // Ensure mimetype is one of the allowed types
          mimetype: file.mimetype as 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp',
          originalname: file.originalname,
        }));
      }

      if (!questionId || typeof answer !== 'string' || typeof questionId !== 'string') {
        return res.status(400).json({ error: 'Invalid question ID or answer' });
      }

      if (options) {
        const validationErrors = validateCodegenOptions(options);
        if (validationErrors.length > 0) {
          return res.status(400).json({ errors: validationErrors });
        }
      }

      // Call the service method, passing the image data and new optional fields
      await service.answerQuestion(
        questionId,
        answer,
        confirmed,
        images, // Pass the processed image data
        options as CodegenOptions, // Pass CodegenOptions
        selectedActionType,
      );

      res.json({ message: 'Question answered successfully' });
    } catch (error) {
      console.error('Error answering question:', error);
      res.status(500).json({ error: 'An error occurred while answering question' });
    }
  });
});
