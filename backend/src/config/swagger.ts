import { Express } from 'express';
import swaggerJSDoc from 'swagger-jsdoc';
import swaggerUi from 'swagger-ui-express';
import { env } from './env';

const definition: swaggerJSDoc.OAS3Definition = {
  openapi: '3.0.0',
  info: {
    title: 'izLearn API',
    version: '1.0.0',
    description:
      'GxP-compliant Learning Management System API (21 CFR Part 11 / EU Annex 11 / ALCOA++). ' +
      'All write operations on GMP records are audited; UPDATE/DELETE require a reasonForChange.',
  },
  servers: [{ url: '/api', description: 'izLearn API root' }],
  components: {
    securitySchemes: {
      bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
    },
    schemas: {
      ApiError: {
        type: 'object',
        properties: {
          success: { type: 'boolean', example: false },
          error: {
            type: 'object',
            properties: {
              code: { type: 'string' },
              message: { type: 'string' },
              details: { type: 'object' },
            },
          },
        },
      },
      ESignature: {
        type: 'object',
        required: ['windowsUsername', 'signaturePassword', 'meaning'],
        properties: {
          windowsUsername: { type: 'string' },
          signaturePassword: { type: 'string', format: 'password' },
          meaning: { type: 'string', enum: ['Approved', 'Reviewed', 'Rejected', 'Performed', 'Acknowledged'] },
        },
      },
    },
  },
  security: [{ bearerAuth: [] }],
};

const spec = swaggerJSDoc({
  definition,
  apis: ['./src/routes/*.ts', './src/controllers/*.ts'],
});

export function setupSwagger(app: Express): void {
  app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(spec, { customSiteTitle: 'izLearn API Docs' }));
  app.get('/api-docs.json', (_req, res) => res.json(spec));
  if (!env.isProd) {
    // eslint-disable-next-line no-console
    console.log('Swagger UI available at /api-docs');
  }
}
