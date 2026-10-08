export class EntityNotFoundError extends Error {
  constructor(entityName: string, id: string) {
    super(`${entityName} with id "${id}" was not found.`);
    this.name = 'EntityNotFoundError';
  }
}

export class DuplicateCardError extends Error {
  constructor(target: string, targetLanguage: string) {
    super(
      `A card for "${target}" already exists in target language "${targetLanguage}".`,
    );
    this.name = 'DuplicateCardError';
  }
}

export class CardInUseError extends Error {
  constructor(cardId: string, lessonCount: number) {
    super(`Card "${cardId}" is used by ${lessonCount} lesson(s).`);
    this.name = 'CardInUseError';
  }
}

export class InvalidEntityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidEntityError';
  }
}
