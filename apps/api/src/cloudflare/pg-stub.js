export default { Pool: class { constructor() { throw new Error('PostgreSQL must not be initialized in Workers'); } } };
