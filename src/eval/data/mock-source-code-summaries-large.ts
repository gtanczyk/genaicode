/**
 * This file contains a large dataset of mock source code summaries representing a complex todo app.
 * The dataset includes various components such as user authentication, task management, project organization, settings, and other related functionalities.
 * Each entry in the dataset includes the file path, a brief description of the file's purpose, and a list of its dependencies.
 */

import { generateFileId } from '../../files/file-id-utils';
import { SourceCodeMap } from '../../files/source-code-types';

export const MOCK_SOURCE_CODE_SUMMARIES_LARGE_ROOT_DIR = '/project/src/todo-app';

export const MOCK_SOURCE_CODE_SUMMARIES_LARGE: SourceCodeMap = {
  '/project/src/todo-app/auth/user-auth.ts': {
    fileId: generateFileId('/project/src/todo-app/auth/user-auth.ts'),
    summary: 'Handles user authentication logic, including user registration, login, and session management.',
    dependencies: [
      {
        path: '/project/src/todo-app/utils/security-utils.ts',
        type: 'local',
      },
      {
        path: '/project/src/todo-app/database/user-db.ts',
        type: 'local',
      },
      {
        path: 'jsonwebtoken',
        type: 'external',
      },
    ],
  },
  '/project/src/todo-app/auth/login.ts': {
    fileId: generateFileId('/project/src/todo-app/auth/login.ts'),
    summary: 'Manages user login functionality, including form validation and authentication.',
    dependencies: [
      {
        path: '/project/src/todo-app/auth/user-auth.ts',
        type: 'local',
      },
      {
        path: '/project/src/todo-app/utils/validation-utils.ts',
        type: 'local',
      },
    ],
  },
  '/project/src/todo-app/auth/registration.ts': {
    fileId: generateFileId('/project/src/todo-app/auth/registration.ts'),
    summary: 'Handles user registration, including form validation and new user creation.',
    dependencies: [
      {
        path: '/project/src/todo-app/auth/user-auth.ts',
        type: 'local',
      },
      {
        path: '/project/src/todo-app/utils/validation-utils.ts',
        type: 'local',
      },
    ],
  },
  '/project/src/todo-app/auth/session-management.ts': {
    fileId: generateFileId('/project/src/todo-app/auth/session-management.ts'),
    summary: 'Manages user sessions, including token generation and validation.',
    dependencies: [
      {
        path: '/project/src/todo-app/auth/user-auth.ts',
        type: 'local',
      },
      {
        path: '/project/src/todo-app/utils/security-utils.ts',
        type: 'local',
      },
    ],
  },
  '/project/src/todo-app/tasks/task-manager.ts': {
    fileId: generateFileId('/project/src/todo-app/tasks/task-manager.ts'),
    summary: 'Provides core functionality for managing tasks, including creating, updating, and deleting tasks.',
    dependencies: [
      {
        path: '/project/src/todo-app/database/task-db.ts',
        type: 'local',
      },
      {
        path: '/project/src/todo-app/utils/validation-utils.ts',
        type: 'local',
      },
    ],
  },
  '/project/src/todo-app/tasks/create-task.ts': {
    fileId: generateFileId('/project/src/todo-app/tasks/create-task.ts'),
    summary: 'Handles the creation of new tasks, including form validation and task creation logic.',
    dependencies: [
      {
        path: '/project/src/todo-app/tasks/task-manager.ts',
        type: 'local',
      },
      {
        path: '/project/src/todo-app/utils/validation-utils.ts',
        type: 'local',
      },
    ],
  },
  '/project/src/todo-app/tasks/update-task.ts': {
    fileId: generateFileId('/project/src/todo-app/tasks/update-task.ts'),
    summary: 'Manages the updating of existing tasks, including form validation and task update logic.',
    dependencies: [
      {
        path: '/project/src/todo-app/tasks/task-manager.ts',
        type: 'local',
      },
      {
        path: '/project/src/todo-app/utils/validation-utils.ts',
        type: 'local',
      },
    ],
  },
  '/project/src/todo-app/tasks/delete-task.ts': {
    fileId: generateFileId('/project/src/todo-app/tasks/delete-task.ts'),
    summary: 'Handles the deletion of tasks, including confirmation and deletion logic.',
    dependencies: [
      {
        path: '/project/src/todo-app/tasks/task-manager.ts',
        type: 'local',
      },
    ],
  },
  '/project/src/todo-app/projects/project-manager.ts': {
    fileId: generateFileId('/project/src/todo-app/projects/project-manager.ts'),
    summary: 'Provides core functionality for managing projects, including creating, updating, and deleting projects.',
    dependencies: [
      {
        path: '/project/src/todo-app/database/project-db.ts',
        type: 'local',
      },
      {
        path: '/project/src/todo-app/utils/validation-utils.ts',
        type: 'local',
      },
    ],
  },
  '/project/src/todo-app/projects/create-project.ts': {
    fileId: generateFileId('/project/src/todo-app/projects/create-project.ts'),
    summary: 'Handles the creation of new projects, including form validation and project creation logic.',
    dependencies: [
      {
        path: '/project/src/todo-app/projects/project-manager.ts',
        type: 'local',
      },
      {
        path: '/project/src/todo-app/utils/validation-utils.ts',
        type: 'local',
      },
    ],
  },
  '/project/src/todo-app/projects/update-project.ts': {
    fileId: generateFileId('/project/src/todo-app/projects/update-project.ts'),
    summary: 'Manages the updating of existing projects, including form validation and project update logic.',
    dependencies: [
      {
        path: '/project/src/todo-app/projects/project-manager.ts',
        type: 'local',
      },
      {
        path: '/project/src/todo-app/utils/validation-utils.ts',
        type: 'local',
      },
    ],
  },
  '/project/src/todo-app/projects/delete-project.ts': {
    fileId: generateFileId('/project/src/todo-app/projects/delete-project.ts'),
    summary: 'Handles the deletion of projects, including confirmation and deletion logic.',
    dependencies: [
      {
        path: '/project/src/todo-app/projects/project-manager.ts',
        type: 'local',
      },
    ],
  },
  '/project/src/todo-app/settings/user-settings.ts': {
    fileId: generateFileId('/project/src/todo-app/settings/user-settings.ts'),
    summary: 'Manages user-specific settings, including profile updates and preference management.',
    dependencies: [
      {
        path: '/project/src/todo-app/database/user-db.ts',
        type: 'local',
      },
      {
        path: '/project/src/todo-app/utils/validation-utils.ts',
        type: 'local',
      },
    ],
  },
  '/project/src/todo-app/settings/update-profile.ts': {
    fileId: generateFileId('/project/src/todo-app/settings/update-profile.ts'),
    summary: 'Handles user profile updates, including form validation and profile update logic.',
    dependencies: [
      {
        path: '/project/src/todo-app/settings/user-settings.ts',
        type: 'local',
      },
      {
        path: '/project/src/todo-app/utils/validation-utils.ts',
        type: 'local',
      },
    ],
  },
  '/project/src/todo-app/settings/preferences.ts': {
    fileId: generateFileId('/project/src/todo-app/settings/preferences.ts'),
    summary: 'Manages user preferences, such as theme selection and notification settings.',
    dependencies: [
      {
        path: '/project/src/todo-app/settings/user-settings.ts',
        type: 'local',
      },
    ],
  },
  '/project/src/todo-app/utils/security-utils.ts': {
    fileId: generateFileId('/project/src/todo-app/utils/security-utils.ts'),
    summary: 'Provides utility functions for security-related tasks, such as password hashing and token generation.',
    dependencies: [
      {
        path: 'bcrypt',
        type: 'external',
      },
      {
        path: 'jsonwebtoken',
        type: 'external',
      },
    ],
  },
  '/project/src/todo-app/utils/validation-utils.ts': {
    fileId: generateFileId('/project/src/todo-app/utils/validation-utils.ts'),
    summary: 'Contains utility functions for form validation and input sanitization.',
    dependencies: [
      {
        path: 'validator',
        type: 'external',
      },
    ],
  },
  '/project/src/todo-app/utils/db-utils.ts': {
    fileId: generateFileId('/project/src/todo-app/utils/db-utils.ts'),
    summary: 'Provides utility functions for database operations, such as connection management and query building.',
    dependencies: [
      {
        path: 'mongoose',
        type: 'external',
      },
    ],
  },
  '/project/src/todo-app/utils/notification-utils.ts': {
    fileId: generateFileId('/project/src/todo-app/utils/notification-utils.ts'),
    summary:
      'Provides utility functions for notification-related tasks, such as formatting and scheduling notifications.',
    dependencies: [],
  },
  '/project/src/todo-app/utils/search-utils.ts': {
    fileId: generateFileId('/project/src/todo-app/utils/search-utils.ts'),
    summary: 'Provides utility functions for search-related tasks, such as query building and result ranking.',
    dependencies: [],
  },
  '/project/src/todo-app/utils/report-utils.ts': {
    fileId: generateFileId('/project/src/todo-app/utils/report-utils.ts'),
    summary: 'Provides utility functions for report-related tasks, such as data aggregation and formatting.',
    dependencies: [],
  },
  '/project/src/todo-app/utils/integration-utils.ts': {
    fileId: generateFileId('/project/src/todo-app/utils/integration-utils.ts'),
    summary: 'Provides utility functions for integration-related tasks, such as API authentication and data syncing.',
    dependencies: [],
  },
  '/project/src/todo-app/utils/api-utils.ts': {
    fileId: generateFileId('/project/src/todo-app/utils/api-utils.ts'),
    summary: 'Provides utility functions for API-related tasks, such as request validation and response formatting.',
    dependencies: [],
  },
  '/project/src/todo-app/database/user-db.ts': {
    fileId: generateFileId('/project/src/todo-app/database/user-db.ts'),
    summary: 'Handles database operations related to user data, including user creation, retrieval, and updates.',
    dependencies: [
      {
        path: '/project/src/todo-app/utils/db-utils.ts',
        type: 'local',
      },
      {
        path: 'mongoose',
        type: 'external',
      },
    ],
  },
  '/project/src/todo-app/database/task-db.ts': {
    fileId: generateFileId('/project/src/todo-app/database/task-db.ts'),
    summary:
      'Manages database operations related to task data, including task creation, retrieval, updates, and deletion.',
    dependencies: [
      {
        path: '/project/src/todo-app/utils/db-utils.ts',
        type: 'local',
      },
      {
        path: 'mongoose',
        type: 'external',
      },
    ],
  },
  '/project/src/todo-app/database/project-db.ts': {
    fileId: generateFileId('/project/src/todo-app/database/project-db.ts'),
    summary:
      'Handles database operations related to project data, including project creation, retrieval, updates, and deletion.',
    dependencies: [
      {
        path: '/project/src/todo-app/utils/db-utils.ts',
        type: 'local',
      },
      {
        path: 'mongoose',
        type: 'external',
      },
    ],
  },
  '/project/src/todo-app/database/integration-db.ts': {
    fileId: generateFileId('/project/src/todo-app/database/integration-db.ts'),
    summary:
      'Manages database operations related to integration data, including storing and retrieving integration settings.',
    dependencies: [
      {
        path: '/project/src/todo-app/utils/db-utils.ts',
        type: 'local',
      },
    ],
  },
  '/project/src/todo-app/notifications/notification-manager.ts': {
    fileId: generateFileId('/project/src/todo-app/notifications/notification-manager.ts'),
    summary: 'Manages user notifications, including sending and retrieving notifications.',
    dependencies: [
      {
        path: '/project/src/todo-app/database/notification-db.ts',
        type: 'local',
      },
      {
        path: '/project/src/todo-app/utils/notification-utils.ts',
        type: 'local',
      },
    ],
  },
  '/project/src/todo-app/notifications/send-notification.ts': {
    fileId: generateFileId('/project/src/todo-app/notifications/send-notification.ts'),
    summary: 'Handles the sending of notifications to users, including email and push notifications.',
    dependencies: [
      {
        path: '/project/src/todo-app/notifications/notification-manager.ts',
        type: 'local',
      },
      {
        path: 'nodemailer',
        type: 'external',
      },
    ],
  },
  '/project/src/todo-app/notifications/notification-db.ts': {
    fileId: generateFileId('/project/src/todo-app/notifications/notification-db.ts'),
    summary: 'Manages database operations related to notification data, including notification creation and retrieval.',
    dependencies: [
      {
        path: '/project/src/todo-app/utils/db-utils.ts',
        type: 'local',
      },
      {
        path: 'mongoose',
        type: 'external',
      },
    ],
  },
  '/project/src/todo-app/search/search-manager.ts': {
    fileId: generateFileId('/project/src/todo-app/search/search-manager.ts'),
    summary:
      'Handles search functionality within the app, allowing users to search for tasks, projects, and other data.',
    dependencies: [
      {
        path: '/project/src/todo-app/search/search-db.ts',
        type: 'local',
      },
      {
        path: '/project/src/todo-app/utils/search-utils.ts',
        type: 'local',
      },
    ],
  },
  '/project/src/todo-app/search/search-db.ts': {
    fileId: generateFileId('/project/src/todo-app/search/search-db.ts'),
    summary: 'Manages database operations related to search indexing and querying.',
    dependencies: [
      {
        path: '/project/src/todo-app/utils/db-utils.ts',
        type: 'local',
      },
      {
        path: 'elasticsearch',
        type: 'external',
      },
    ],
  },
  '/project/src/todo-app/reporting/report-manager.ts': {
    fileId: generateFileId('/project/src/todo-app/reporting/report-manager.ts'),
    summary: 'Generates reports on user activity, task completion, and project progress.',
    dependencies: [
      {
        path: '/project/src/todo-app/database/report-db.ts',
        type: 'local',
      },
      {
        path: '/project/src/todo-app/utils/report-utils.ts',
        type: 'local',
      },
    ],
  },
  '/project/src/todo-app/reporting/generate-report.ts': {
    fileId: generateFileId('/project/src/todo-app/reporting/generate-report.ts'),
    summary: 'Handles the generation of various types of reports, including CSV and PDF exports.',
    dependencies: [
      {
        path: '/project/src/todo-app/reporting/report-manager.ts',
        type: 'local',
      },
      {
        path: 'pdfkit',
        type: 'external',
      },
    ],
  },
  '/project/src/todo-app/reporting/report-db.ts': {
    fileId: generateFileId('/project/src/todo-app/reporting/report-db.ts'),
    summary: 'Manages database operations related to report data, including report generation and retrieval.',
    dependencies: [
      {
        path: '/project/src/todo-app/utils/db-utils.ts',
        type: 'local',
      },
    ],
  },
  '/project/src/todo-app/integrations/integration-manager.ts': {
    fileId: generateFileId('/project/src/todo-app/integrations/integration-manager.ts'),
    summary: 'Manages integrations with third-party services, such as Slack, Trello, and Google Calendar.',
    dependencies: [
      {
        path: '/project/src/todo-app/database/integration-db.ts',
        type: 'local',
      },
      {
        path: '/project/src/todo-app/utils/integration-utils.ts',
        type: 'local',
      },
    ],
  },
  '/project/src/todo-app/integrations/slack.ts': {
    fileId: generateFileId('/project/src/todo-app/integrations/slack.ts'),
    summary: 'Handles integration with Slack, allowing users to receive notifications and updates in Slack.',
    dependencies: [
      {
        path: '/project/src/todo-app/integrations/integration-manager.ts',
        type: 'local',
      },
      {
        path: 'slack-api',
        type: 'external',
      },
    ],
  },
  '/project/src/todo-app/integrations/trello.ts': {
    fileId: generateFileId('/project/src/todo-app/integrations/trello.ts'),
    summary: 'Manages integration with Trello, allowing users to sync tasks and projects with Trello boards.',
    dependencies: [
      {
        path: '/project/src/todo-app/integrations/integration-manager.ts',
        type: 'local',
      },
      {
        path: 'trello-api',
        type: 'external',
      },
    ],
  },
  '/project/src/todo-app/integrations/google-calendar.ts': {
    fileId: generateFileId('/project/src/todo-app/integrations/google-calendar.ts'),
    summary:
      'Handles integration with Google Calendar, allowing users to sync tasks and deadlines with their calendar.',
    dependencies: [
      {
        path: '/project/src/todo-app/integrations/integration-manager.ts',
        type: 'local',
      },
      {
        path: 'google-api',
        type: 'external',
      },
    ],
  },
  '/project/src/todo-app/api/api-manager.ts': {
    fileId: generateFileId('/project/src/todo-app/api/api-manager.ts'),
    summary:
      'Manages the REST API for the todo app, handling incoming requests and routing them to the appropriate handlers.',
    dependencies: [
      {
        path: '/project/src/todo-app/api/auth-routes.ts',
        type: 'local',
      },
      {
        path: '/project/src/todo-app/api/task-routes.ts',
        type: 'local',
      },
      {
        path: '/project/src/todo-app/api/project-routes.ts',
        type: 'local',
      },
      {
        path: '/project/src/todo-app/api/settings-routes.ts',
        type: 'local',
      },
      {
        path: '/project/src/todo-app/utils/api-utils.ts',
        type: 'local',
      },
      {
        path: 'express',
        type: 'external',
      },
    ],
  },
  '/project/src/todo-app/api/auth-routes.ts': {
    fileId: generateFileId('/project/src/todo-app/api/auth-routes.ts'),
    summary: 'Defines API routes for user authentication, including registration, login, and session management.',
    dependencies: [
      {
        path: '/project/src/todo-app/auth/user-auth.ts',
        type: 'local',
      },
      {
        path: '/project/src/todo-app/utils/api-utils.ts',
        type: 'local',
      },
      {
        path: 'express',
        type: 'external',
      },
    ],
  },
  '/project/src/todo-app/api/task-routes.ts': {
    fileId: generateFileId('/project/src/todo-app/api/task-routes.ts'),
    summary: 'Defines API routes for task management, including creating, updating, and deleting tasks.',
    dependencies: [
      {
        path: '/project/src/todo-app/tasks/task-manager.ts',
        type: 'local',
      },
      {
        path: '/project/src/todo-app/utils/api-utils.ts',
        type: 'local',
      },
      {
        path: 'express',
        type: 'external',
      },
    ],
  },
  '/project/src/todo-app/api/project-routes.ts': {
    fileId: generateFileId('/project/src/todo-app/api/project-routes.ts'),
    summary: 'Defines API routes for project management, including creating, updating, and deleting projects.',
    dependencies: [
      {
        path: '/project/src/todo-app/projects/project-manager.ts',
        type: 'local',
      },
      {
        path: '/project/src/todo-app/utils/api-utils.ts',
        type: 'local',
      },
      {
        path: 'express',
        type: 'external',
      },
    ],
  },
  '/project/src/todo-app/api/settings-routes.ts': {
    fileId: generateFileId('/project/src/todo-app/api/settings-routes.ts'),
    summary: 'Defines API routes for user settings, including profile updates and preference management.',
    dependencies: [
      {
        path: '/project/src/todo-app/settings/user-settings.ts',
        type: 'local',
      },
      {
        path: '/project/src/todo-app/utils/api-utils.ts',
        type: 'local',
      },
      {
        path: 'express',
        type: 'external',
      },
    ],
  },
  '/project/src/todo-app/frontend/components/app.tsx': {
    fileId: generateFileId('/project/src/todo-app/frontend/components/app.tsx'),
    summary: 'Main component for the frontend of the todo app, handling routing and rendering of other components.',
    dependencies: [
      {
        path: '/project/src/todo-app/frontend/components/auth/login-form.tsx',
        type: 'local',
      },
      {
        path: '/project/src/todo-app/frontend/components/auth/registration-form.tsx',
        type: 'local',
      },
      {
        path: '/project/src/todo-app/frontend/components/tasks/task-list.tsx',
        type: 'local',
      },
      {
        path: '/project/src/todo-app/frontend/components/projects/project-list.tsx',
        type: 'local',
      },
      {
        path: '/project/src/todo-app/frontend/components/settings/settings-form.tsx',
        type: 'local',
      },
      {
        path: '/project/src/todo-app/frontend/utils/api-client.ts',
        type: 'local',
      },
      {
        path: 'react',
        type: 'external',
      },
      {
        path: 'react-router-dom',
        type: 'external',
      },
    ],
  },
  '/project/src/todo-app/frontend/components/auth/login-form.tsx': {
    fileId: generateFileId('/project/src/todo-app/frontend/components/auth/login-form.tsx'),
    summary: 'Renders the login form and handles user login actions.',
    dependencies: [
      {
        path: '/project/src/todo-app/frontend/utils/api-client.ts',
        type: 'local',
      },
      {
        path: 'react',
        type: 'external',
      },
    ],
  },
  '/project/src/todo-app/frontend/components/auth/registration-form.tsx': {
    fileId: generateFileId('/project/src/todo-app/frontend/components/auth/registration-form.tsx'),
    summary: 'Renders the registration form and handles user registration actions.',
    dependencies: [
      {
        path: '/project/src/todo-app/frontend/utils/api-client.ts',
        type: 'local',
      },
      {
        path: 'react',
        type: 'external',
      },
    ],
  },
  '/project/src/todo-app/frontend/components/tasks/task-list.tsx': {
    fileId: generateFileId('/project/src/todo-app/frontend/components/tasks/task-list.tsx'),
    summary: 'Displays a list of tasks and provides actions for creating, updating, and deleting tasks.',
    dependencies: [
      {
        path: '/project/src/todo-app/frontend/components/tasks/task-item.tsx',
        type: 'local',
      },
      {
        path: '/project/src/todo-app/frontend/utils/api-client.ts',
        type: 'local',
      },
      {
        path: 'react',
        type: 'external',
      },
    ],
  },
  '/project/src/todo-app/frontend/components/tasks/task-item.tsx': {
    fileId: generateFileId('/project/src/todo-app/frontend/components/tasks/task-item.tsx'),
    summary: 'Renders a single task item and handles actions for updating and deleting the task.',
    dependencies: [
      {
        path: '/project/src/todo-app/frontend/utils/api-client.ts',
        type: 'local',
      },
      {
        path: 'react',
        type: 'external',
      },
    ],
  },
  '/project/src/todo-app/frontend/components/projects/project-list.tsx': {
    fileId: generateFileId('/project/src/todo-app/frontend/components/projects/project-list.tsx'),
    summary: 'Displays a list of projects and provides actions for creating, updating, and deleting projects.',
    dependencies: [
      {
        path: '/project/src/todo-app/frontend/components/projects/project-item.tsx',
        type: 'local',
      },
      {
        path: '/project/src/todo-app/frontend/utils/api-client.ts',
        type: 'local',
      },
      {
        path: 'react',
        type: 'external',
      },
    ],
  },
  '/project/src/todo-app/frontend/components/projects/project-item.tsx': {
    fileId: generateFileId('/project/src/todo-app/frontend/components/projects/project-item.tsx'),
    summary: 'Renders a single project item and handles actions for updating and deleting the project.',
    dependencies: [
      {
        path: '/project/src/todo-app/frontend/utils/api-client.ts',
        type: 'local',
      },
      {
        path: 'react',
        type: 'external',
      },
    ],
  },
  '/project/src/todo-app/frontend/components/settings/settings-form.tsx': {
    fileId: generateFileId('/project/src/todo-app/frontend/components/settings/settings-form.tsx'),
    summary: 'Renders the user settings form and handles actions for updating user preferences.',
    dependencies: [
      {
        path: '/project/src/todo-app/frontend/utils/api-client.ts',
        type: 'local',
      },
      {
        path: 'react',
        type: 'external',
      },
    ],
  },
  '/project/src/todo-app/frontend/utils/api-client.ts': {
    fileId: generateFileId('/project/src/todo-app/frontend/utils/api-client.ts'),
    summary:
      'Provides utility functions for making API requests to the backend, including handling authentication and error handling.',
    dependencies: [],
  },
};
