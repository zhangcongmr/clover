export interface CliOptions {
  commandName: string;
  description: string;
  getVersion: () => string;
  defaultPort: number;
  portEnvKey: string;
  tokenSecretEnvKey: string;
}

export type CliResult =
  | { shouldExit: false }
  | { shouldExit: true; exitCode: number };

export function processCliArgs(args: readonly string[], options: CliOptions): CliResult {
  if (args.includes('-h') || args.includes('--help')) {
    console.log([
      `${options.commandName} - ${options.description}`,
      '',
      'Usage:',
      `  ${options.commandName} [options]`,
      '',
      'Options:',
      `  -v, --version  Print the ${options.commandName} version`,
      '  -h, --help     Show this help message',
      `  -p, --port N   Set the server port (default ${options.defaultPort})`,
      '',
      'Environment:',
      `  ${options.portEnvKey.padEnd(22)}Server port (default ${options.defaultPort})`,
      `  ${options.tokenSecretEnvKey.padEnd(22)}Auth token secret for the server`,
    ].join('\n'));
    return { shouldExit: true, exitCode: 0 };
  }

  if (args.includes('-v') || args.includes('--version')) {
    console.log(options.getVersion());
    return { shouldExit: true, exitCode: 0 };
  }

  const portIndex = args.findIndex((arg) => arg === '-p' || arg === '--port');
  if (portIndex !== -1) {
    const rawPort = args[portIndex + 1];
    const port = Number(rawPort);
    if (Number.isInteger(port) && port > 0 && port <= 65535) {
      process.env[options.portEnvKey] = String(port);
    } else {
      console.error(`Invalid port: ${rawPort}`);
      return { shouldExit: true, exitCode: 1 };
    }
  }

  return { shouldExit: false };
}
