const unavailable=()=>{throw new Error('Azure Blob SDK must not be called in Workers');};
export class BlobServiceClient { constructor(){unavailable();} }
export class StorageSharedKeyCredential { constructor(){unavailable();} }
export class BlobSASPermissions { static parse(){unavailable();} }
export function generateBlobSASQueryParameters(){unavailable();}
