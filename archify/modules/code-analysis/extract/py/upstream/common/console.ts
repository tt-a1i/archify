// Parser timing accepts only a message sink; it owns no output process.
export interface ConsoleInterface {
    log(message: string): void;
    info(message: string): void;
    warn(message: string): void;
    error(message: string): void;
}
