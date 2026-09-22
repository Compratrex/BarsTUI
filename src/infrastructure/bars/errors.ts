export class SessionExpiredError extends Error {
  constructor(message = 'Сессия БАРСа истекла. Войди снова.') {
    super(message);
    this.name = 'SessionExpiredError';
  }
}
