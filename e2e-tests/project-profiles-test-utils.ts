import { ChildProcess, spawn } from 'child_process';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';

/**
 * Types of Go frameworks that can be mocked for testing
 */
export type GoFramework = 'gin' | 'echo' | 'chi' | 'fiber';

/**
 * Types of Maven project configurations that can be mocked
 */
export type MavenProjectType = 'standard' | 'spring-boot' | 'jakarta-ee' | 'multi-module';

/**
 * Configuration for creating a mock Maven project
 */
export interface MavenProjectConfig {
  type: MavenProjectType;
  groupId?: string;
  artifactId?: string;
  version?: string;
  packaging?: string;
  dependencies?: Array<{
    groupId: string;
    artifactId: string;
    version?: string;
  }>;
  modules?: string[];
  useWrapper?: boolean;
  useCheckstyle?: boolean;
  useKotlin?: boolean;
  useScala?: boolean;
}

/**
 * Configuration for creating a mock Go project
 */
export interface GoProjectConfig {
  moduleName: string;
  framework?: GoFramework;
  isWorkspace?: boolean;
  workspaceModules?: string[];
  useLinter?: boolean;
}

/**
 * Create a temporary directory for testing
 */
export async function createTempDir(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'genaicode-test-'));
  return dir;
}

/**
 * Run genaicode in the specified directory
 */
export async function runGenaicode(cwd: string): Promise<void> {
  return new Promise((resolve, reject) => {
    // Start GenAIcode in interactive mode to allow .genaicoderc creation
    const genAICodeProcess: ChildProcess = spawn(
      'node',
      [
        path.resolve(__dirname, '..', 'bin', 'genaicode.cjs'),
        '--interactive',
        '--ai-service=vertex-ai',
        '--force-dist',
      ],
      {
        cwd,
        env: { ...process.env, NODE_ENV: 'test' },
      },
    );

    let stdoutData = '';
    let stderrData = '';

    genAICodeProcess.stdout!.on('data', (data) => {
      stdoutData += data.toString();
      // Check for the confirmation message that .genaicoderc was created
      if (stdoutData.includes('Created .genaicoderc')) {
        console.log('GenAIcode process output:', stdoutData);
        genAICodeProcess.kill();
        resolve();
      } else if (
        stdoutData.includes('would you like to create one') &&
        !stdoutData.includes('with detected project profile')
      ) {
        // Respond to the prompt to create .genaicoderc
        genAICodeProcess.stdin!.write('y\n');
      }
    });

    genAICodeProcess.stderr!.on('data', (data) => {
      stderrData += data.toString();
    });

    genAICodeProcess.on('error', (error) => {
      reject(new Error(`Failed to start genaicode: ${error.message}`));
    });

    genAICodeProcess.on('exit', (code) => {
      if (code !== null && code !== 0 && !stdoutData.includes('Created .genaicoderc')) {
        reject(new Error(`GenAIcode process exited with code ${code}. stdout: ${stdoutData}, stderr: ${stderrData}`));
      }
    });

    // Set a timeout to prevent hanging
    setTimeout(() => {
      genAICodeProcess.kill();
      reject(new Error('GenAIcode process timed out'));
    }, 30000);
  });
}

/**
 * Create a mock npm project structure
 */
export async function createMockNpmProject(projectDir: string) {
  // Create package.json
  await fs.writeFile(
    path.join(projectDir, 'package.json'),
    JSON.stringify({
      name: 'test-project',
      version: '1.0.0',
      scripts: {
        lint: 'eslint .',
        test: 'vitest',
      },
      dependencies: {
        typescript: '^5.0.0',
      },
    }),
  );

  // Create tsconfig.json to simulate a TypeScript project
  await fs.writeFile(
    path.join(projectDir, 'tsconfig.json'),
    JSON.stringify({
      compilerOptions: {
        target: 'es2020',
        module: 'esnext',
      },
    }),
  );

  // Create package-lock.json to simulate an npm project
  await fs.writeFile(
    path.join(projectDir, 'package-lock.json'),
    JSON.stringify({
      name: 'test-project',
      lockfileVersion: 2,
      requires: true,
      packages: {},
    }),
  );
}

/**
 * Create a mock Go project structure
 */
export async function createMockGoProject(projectDir: string, config: GoProjectConfig) {
  if (config.isWorkspace) {
    // Create go.work file
    const workContent = ['go 1.21', ''];
    if (config.workspaceModules?.length) {
      workContent.push('use (');
      config.workspaceModules.forEach((mod) => workContent.push(`\t${mod}`));
      workContent.push(')');
    }
    await fs.writeFile(path.join(projectDir, 'go.work'), workContent.join('\n'));

    // Create workspace modules
    if (config.workspaceModules?.length) {
      for (const mod of config.workspaceModules) {
        await fs.mkdir(path.join(projectDir, mod), { recursive: true });
        await createGoModule(path.join(projectDir, mod), {
          ...config,
          moduleName: `${config.moduleName}/${mod}`,
          isWorkspace: false,
        });
      }
    }
  } else {
    await createGoModule(projectDir, config);
  }

  // Create linter config if requested
  if (config.useLinter) {
    await fs.writeFile(
      path.join(projectDir, '.golangci.yml'),
      `
linters:
  enable:
    - gofmt
    - golint
    - govet
`,
    );
  }
}

/**
 * Helper function to create a Go module
 */
async function createGoModule(moduleDir: string, config: GoProjectConfig) {
  // Create go.mod file
  const modContent = [`module ${config.moduleName}`, 'go 1.21', ''];
  if (config.framework) {
    modContent.push('require (');
    switch (config.framework) {
      case 'gin':
        modContent.push('\tgithub.com/gin-gonic/gin v1.9.1');
        break;
      case 'echo':
        modContent.push('\tgithub.com/labstack/echo/v4 v4.11.3');
        break;
      case 'chi':
        modContent.push('\tgithub.com/go-chi/chi/v5 v5.0.10');
        break;
      case 'fiber':
        modContent.push('\tgithub.com/gofiber/fiber/v2 v2.50.0');
        break;
    }
    modContent.push(')');
  }
  await fs.writeFile(path.join(moduleDir, 'go.mod'), modContent.join('\n'));

  // Create main.go with appropriate imports
  let mainContent = 'package main\n\n';
  if (config.framework) {
    switch (config.framework) {
      case 'gin':
        mainContent += `
import (
\t"github.com/gin-gonic/gin"
)

func main() {
\tr := gin.Default()
\tr.GET("/ping", func(c *gin.Context) {
\t\tc.JSON(200, gin.H{"message": "pong"})
\t})
\tr.Run()
}
`;
        break;
      case 'echo':
        mainContent += `
import (
\t"github.com/labstack/echo/v4"
)

func main() {
\te := echo.New()
\te.GET("/ping", func(c echo.Context) error {
\t\treturn c.JSON(200, map[string]string{"message": "pong"})
\t})
\te.Start(":8080")
}
`;
        break;
      default:
        mainContent += `
func main() {
\tprintln("Hello, World!")
}
`;
    }
  } else {
    mainContent += `
func main() {
\tprintln("Hello, World!")
}
`;
  }
  await fs.writeFile(path.join(moduleDir, 'main.go'), mainContent);

  // Create go.sum (empty is fine for testing)
  await fs.writeFile(path.join(moduleDir, 'go.sum'), '');
}

/**
 * Create a mock Maven project structure
 */
export async function createMockMavenProject(projectDir: string, config: MavenProjectConfig) {
  // Create base project structure
  await fs.mkdir(path.join(projectDir, 'src', 'main', 'java'), { recursive: true });
  await fs.mkdir(path.join(projectDir, 'src', 'test', 'java'), { recursive: true });

  // Create pom.xml
  const pomContent = generatePomXml(config);
  await fs.writeFile(path.join(projectDir, 'pom.xml'), pomContent);

  // Create Maven wrapper if requested
  if (config.useWrapper) {
    await fs.mkdir(path.join(projectDir, '.mvn', 'wrapper'), { recursive: true });
    await fs.writeFile(path.join(projectDir, 'mvnw'), '#!/bin/sh\n# Maven Wrapper Script');
    await fs.writeFile(path.join(projectDir, 'mvnw.cmd'), '@REM Maven Wrapper Script');
    await fs.chmod(path.join(projectDir, 'mvnw'), 0o755);
  }

  // Create checkstyle config if requested
  if (config.useCheckstyle) {
    await fs.mkdir(path.join(projectDir, 'config'), { recursive: true });
    await fs.writeFile(
      path.join(projectDir, 'config', 'checkstyle.xml'),
      '<?xml version="1.0"?>\n<!DOCTYPE module PUBLIC "-//Checkstyle//DTD Checkstyle Configuration 1.3//EN" "https://checkstyle.org/dtds/configuration_1_3.dtd">\n<module name="Checker">\n</module>',
    );
  }

  // For multi-module projects, create module directories
  if (config.type === 'multi-module' && config.modules) {
    for (const module of config.modules) {
      const moduleDir = path.join(projectDir, module);
      await createMockMavenProject(moduleDir, {
        ...config,
        type: 'standard', // Submodules are standard modules
        modules: undefined, // No nested multi-modules
      });
    }
  }
}

/**
 * Helper function to generate pom.xml content
 */
function generatePomXml(config: MavenProjectConfig): string {
  const pomParts = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<project xmlns="http://maven.apache.org/POM/4.0.0" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"',
    '         xsi:schemaLocation="http://maven.apache.org/POM/4.0.0 http://maven.apache.org/xsd/maven-4.0.0.xsd">',
    '    <modelVersion>4.0.0</modelVersion>',
  ];

  // Add parent for Spring Boot
  if (config.type === 'spring-boot') {
    pomParts.push(
      '    <parent>',
      '        <groupId>org.springframework.boot</groupId>',
      '        <artifactId>spring-boot-starter-parent</artifactId>',
      '        <version>3.1.0</version>',
      '    </parent>',
    );
  }

  // Basic project information
  pomParts.push(
    `    <groupId>${config.groupId || 'com.example'}</groupId>`,
    `    <artifactId>${config.artifactId || 'test-project'}</artifactId>`,
    `    <version>${config.version || '1.0.0'}</version>`,
  );

  if (config.packaging) {
    pomParts.push(`    <packaging>${config.packaging}</packaging>`);
  }

  // Properties
  pomParts.push('    <properties>');
  pomParts.push('        <project.build.sourceEncoding>UTF-8</project.build.sourceEncoding>');
  if (config.useKotlin) {
    pomParts.push('        <kotlin.version>1.9.0</kotlin.version>');
  }
  if (config.useScala) {
    pomParts.push('        <scala.version>2.13.10</scala.version>');
  }
  if (config.useCheckstyle) {
    pomParts.push('        <checkstyle.version>10.12.3</checkstyle.version>');
  }
  pomParts.push('    </properties>');

  // Multi-module configuration
  if (config.type === 'multi-module' && config.modules) {
    pomParts.push('    <modules>');
    config.modules.forEach((module) => {
      pomParts.push(`        <module>${module}</module>`);
    });
    pomParts.push('    </modules>');
  }

  // Dependencies
  pomParts.push('    <dependencies>');

  // Add framework-specific dependencies
  switch (config.type) {
    case 'spring-boot':
      pomParts.push(
        '        <dependency>',
        '            <groupId>org.springframework.boot</groupId>',
        '            <artifactId>spring-boot-starter-web</artifactId>',
        '        </dependency>',
      );
      break;
    case 'jakarta-ee':
      pomParts.push(
        '        <dependency>',
        '            <groupId>jakarta.platform</groupId>',
        '            <artifactId>jakarta.jakartaee-api</artifactId>',
        '            <version>10.0.0</version>',
        '            <scope>provided</scope>',
        '        </dependency>',
      );
      break;
  }

  // Add custom dependencies
  if (config.dependencies) {
    config.dependencies.forEach((dep) => {
      pomParts.push(
        '        <dependency>',
        `            <groupId>${dep.groupId}</groupId>`,
        `            <artifactId>${dep.artifactId}</artifactId>`,
        dep.version ? `            <version>${dep.version}</version>` : '',
        '        </dependency>',
      );
    });
  }

  pomParts.push('    </dependencies>');

  // Build configuration
  pomParts.push('    <build>');
  pomParts.push('        <plugins>');

  // Add necessary plugins
  if (config.useCheckstyle) {
    pomParts.push(
      '            <plugin>',
      '                <groupId>org.apache.maven.plugins</groupId>',
      '                <artifactId>maven-checkstyle-plugin</artifactId>',
      '                <version>${checkstyle.version}</version>',
      '            </plugin>',
    );
  }

  if (config.useKotlin) {
    pomParts.push(
      '            <plugin>',
      '                <groupId>org.jetbrains.kotlin</groupId>',
      '                <artifactId>kotlin-maven-plugin</artifactId>',
      '                <version>${kotlin.version}</version>',
      '            </plugin>',
    );
  }

  if (config.useScala) {
    pomParts.push(
      '            <plugin>',
      '                <groupId>net.alchim31.maven</groupId>',
      '                <artifactId>scala-maven-plugin</artifactId>',
      '                <version>4.8.1</version>',
      '            </plugin>',
    );
  }

  pomParts.push('        </plugins>', '    </build>', '</project>');

  return pomParts.join('\n');
}

/**
 * Clean up temporary test directory
 */
export async function cleanupTempDir(tempDir: string) {
  try {
    await fs.rm(tempDir, { recursive: true, force: true });
  } catch (error) {
    console.error('Error cleaning up temporary directory:', error);
  }
}

/**
 * Verify if a file exists
 */
export async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

/**
 * Read and parse JSON file
 */
export async function readJsonFile(filePath: string): Promise<{
  lintCommand?: string;
  extensions?: string[];
}> {
  const content = await fs.readFile(filePath, 'utf-8');
  return JSON.parse(content);
}
