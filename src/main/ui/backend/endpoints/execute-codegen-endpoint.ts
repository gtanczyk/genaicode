import multer from 'multer';
import { registerEndpoint } from '../api-handlers.js';

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
  router.post('/execute-codegen', upload.array('images', MAX_IMAGES), async (req, res) => {
    try {
      const prompt = req.body.prompt;
      const options = JSON.parse(req.body.options);
      const files = req.files as Express.Multer.File[];

      if (!prompt || typeof prompt !== 'string') {
        return res.status(400).json({ error: 'Invalid prompt' });
      }

      const images = files?.map((file) => ({
        buffer: file.buffer,
        mimetype: file.mimetype as 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp',
        originalname: file.originalname,
      }));

      const result = await service.executeCodegen(prompt, options, images);
      res.json({ result });
    } catch (error) {
      console.error('Error executing codegen:', error);
      if (error instanceof multer.MulterError) {
        if (error.code === 'LIMIT_FILE_SIZE') {
          return res.status(400).json({ error: 'File size exceeds the 5MB limit' });
        }
        if (error.code === 'LIMIT_FILE_COUNT') {
          return res.status(400).json({ error: `Maximum of ${MAX_IMAGES} images allowed` });
        }
      }
      res.status(500).json({ error: 'An error occurred while executing codegen' });
    }
  });
});
