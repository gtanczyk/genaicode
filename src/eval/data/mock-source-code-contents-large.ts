export const MOCK_SOURCE_CODE_CONTENTS_LARGE = {
  '/project/src/main/project-manager.ts': {
    content:
      "import { Project } from './project';\n\nexport class ProjectManager {\n  projects: Project[];\n\n  constructor() {\n    this.projects = [];\n  }\n\n  addProject(project: Project) {\n    this.projects.push(project);\n  }\n\n  removeProject(project: Project) {\n    this.projects = this.projects.filter((p) => p !== project);\n  }\n}",
  },
};
