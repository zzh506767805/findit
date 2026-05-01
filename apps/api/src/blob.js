import { BlobServiceClient, StorageSharedKeyCredential, generateBlobSASQueryParameters, BlobSASPermissions } from '@azure/storage-blob';

let _blobCredential;
let _blobServiceClient;

function getBlobServiceClient() {
  const account = process.env.AZURE_STORAGE_ACCOUNT;
  const key = process.env.AZURE_STORAGE_KEY;
  if (!account || !key) return null;
  if (!_blobServiceClient) {
    _blobCredential = new StorageSharedKeyCredential(account, key);
    _blobServiceClient = new BlobServiceClient(`https://${account}.blob.core.windows.net`, _blobCredential);
  }
  return _blobServiceClient;
}

export function getBlobUrl(blobName) {
  const account = process.env.AZURE_STORAGE_ACCOUNT;
  const container = process.env.AZURE_STORAGE_CONTAINER || 'data';
  return `https://${account}.blob.core.windows.net/${container}/${blobName}`;
}

export function getBlobSasUrl(blobUrl) {
  if (!blobUrl || !blobUrl.startsWith('https://')) return blobUrl;
  if (!_blobCredential) getBlobServiceClient();
  if (!_blobCredential) return blobUrl;
  const container = process.env.AZURE_STORAGE_CONTAINER || 'data';
  const blobName = blobUrl.split('/').pop().split('?')[0];
  const expiry = new Date();
  expiry.setHours(expiry.getHours() + 1);

  const sasQuery = generateBlobSASQueryParameters({
    containerName: container,
    blobName,
    permissions: BlobSASPermissions.parse('r'),
    expiresOn: expiry
  }, _blobCredential).toString();

  return `${blobUrl.split('?')[0]}?${sasQuery}`;
}

export async function uploadToBlob(buffer, blobName, contentType) {
  const client = getBlobServiceClient();
  const container = process.env.AZURE_STORAGE_CONTAINER || 'data';
  const blockBlob = client.getContainerClient(container).getBlockBlobClient(blobName);
  await blockBlob.upload(buffer, buffer.length, {
    blobHTTPHeaders: { blobContentType: contentType }
  });
  return getBlobUrl(blobName);
}
