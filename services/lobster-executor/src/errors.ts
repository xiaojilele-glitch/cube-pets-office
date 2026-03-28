export class LobsterExecutorError extends Error {
  constructor(
    message: string,
    readonly statusCode: number
  ) {
    super(message);
    this.name = new.target.name;
  }
}

export class ValidationError extends LobsterExecutorError {
  constructor(message: string) {
    super(message, 400);
  }
}

export class ConflictError extends LobsterExecutorError {
  constructor(message: string) {
    super(message, 409);
  }
}

export class NotFoundError extends LobsterExecutorError {
  constructor(message: string) {
    super(message, 404);
  }
}
