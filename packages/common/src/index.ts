export * from "./model.js";
export * from "./auth.js";
/**
 * A simple greeting utility.
 */

/**
 * Returns a greeting message.
 * @param name The name to greet
 * @returns A formatted greeting string
 */
export function greet(name: string): string {
  return `Hello, ${name}!`;
}

/**
 * A class to greet multiple people.
 */
export class Greeter {
  constructor(private readonly names: readonly string[]) {}

  /**
   * Returns an array of greeting messages.
   */
  sayHello(): string[] {
    return this.names.map((name) => `Hello, ${name}!`);
  }
}