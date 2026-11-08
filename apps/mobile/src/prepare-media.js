import { Platform, Image } from 'react-native';
import * as ImageManipulator from 'expo-image-manipulator';
import * as VideoThumbnails from 'expo-video-thumbnails';
import { File } from 'expo-file-system';
import { fetch as expoFetch } from 'expo/fetch';
async function browserImage(blob,max=1600) {
 const bitmap=await createImageBitmap(blob);const scale=Math.min(1,max/Math.max(bitmap.width,bitmap.height));const canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(bitmap.width*scale));canvas.height=Math.max(1,Math.round(bitmap.height*scale));canvas.getContext('2d').drawImage(bitmap,0,0,canvas.width,canvas.height);bitmap.close();return new Promise(resolve=>canvas.toBlob(resolve,'image/jpeg',0.9));
}
async function photo(input,max=1600) {
 if(Platform.OS==='web')return browserImage(input instanceof Blob?input:await(await fetch(input)).blob(),max);
 const dimensions=await new Promise((resolve,reject)=>Image.getSize(input,(width,height)=>resolve({width,height}),reject));
 const scale=Math.min(1,max/Math.max(dimensions.width,dimensions.height));
 const result=await ImageManipulator.manipulateAsync(input,[{resize:{width:Math.max(1,Math.round(dimensions.width*scale))}}],{compress:0.9,format:ImageManipulator.SaveFormat.JPEG});return result.uri;
}
async function browserFrames(blob) {
 const video=document.createElement('video');video.muted=true;video.preload='metadata';const url=URL.createObjectURL(blob);video.src=url;
 try{await new Promise((resolve,reject)=>{video.onloadedmetadata=resolve;video.onerror=reject;});const duration=Math.min(10,video.duration);if(!Number.isFinite(duration)||duration<=0)throw new Error('Unable to read video');const out=[];for(let i=0;i<Math.min(10,Math.ceil(duration));i++){await new Promise((resolve,reject)=>{video.onseeked=resolve;video.onerror=reject;video.currentTime=Math.min(duration-0.01,Math.max(0.01,i));});const scale=Math.min(1,1024/Math.max(video.videoWidth,video.videoHeight));const canvas=document.createElement('canvas');canvas.width=Math.round(video.videoWidth*scale);canvas.height=Math.round(video.videoHeight*scale);canvas.getContext('2d').drawImage(video,0,0,canvas.width,canvas.height);out.push(await new Promise(resolve=>canvas.toBlob(resolve,'image/jpeg',0.85)));}return out;}finally{URL.revokeObjectURL(url);video.remove();}
}
export async function prepareMedia(file) {
 const video=file.mimeType?.startsWith('video/');
 if(!video){const original=await photo(file.fileUriOrBlob);return {original:file.fileUriOrBlob,mimeType:file.mimeType||'image/jpeg',aiImage:original,thumbnail:await photo(original,640),frames:[]};}
 const original=file.fileUriOrBlob;let frames=[];
 if(Platform.OS==='web')frames=await browserFrames(original instanceof Blob?original:await(await fetch(original)).blob());
 else{const seconds=Math.min(10,Math.max(1,Math.ceil(Number(file.duration||10000)/1000)));for(let i=0;i<seconds;i++){try{const result=await VideoThumbnails.getThumbnailAsync(original,{time:i*1000,quality:0.85});frames.push(await photo(result.uri,1024));}catch(error){if(!frames.length)throw error;break;}}}
 if(!frames.length)throw new Error('Unable to prepare video');return {original,mimeType:file.mimeType||'video/mp4',thumbnail:await photo(frames[0],640),frames};
}
export async function uploadMediaFile(apiUrl,token,jobId,label,file,mimeType) {
 const body=Platform.OS==='web'?file:new File(file);const size=Platform.OS==='web'?body.size:body.size;
 if(size>50*1024*1024)throw new Error('Media must be smaller than 50 MB');
 const call=Platform.OS==='web'?fetch:expoFetch;const response=await call(`${apiUrl}/staging/${jobId}/${label}`,{method:'PUT',headers:{Authorization:`Bearer ${token}`,'Content-Type':mimeType,'X-Upload-Size':String(size||0)},body});
 const data=await response.json().catch(()=>({}));if(!response.ok)throw new Error(data.error||'Media upload failed');return data;
}
