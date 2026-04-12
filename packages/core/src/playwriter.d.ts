/**
 * Ambient type declaration for the optional `playwriter` dependency.
 * The full package is only needed at runtime when authStrategy is "extension".
 * @see https://github.com/remorses/playwriter
 */
declare module "playwriter" {
  export function startPlayWriterCDPRelayServer(opts: {
    port?: number;
    host?: string;
    token?: string;
    logger?: unknown;
  }): Promise<{ close(): void; on(event: string, cb: (data: unknown) => void): void }>;

  export function getCdpUrl(opts: { port?: number; extensionId?: string }): string;
}
