const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
const fs = require('fs');

const r2 = new S3Client({
    region: 'auto',
    endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
        accessKeyId: process.env.R2_ACCESS_KEY_ID,
        secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
    }
});

async function uploadToR2(localPath, r2Key) {
    const fileStream = fs.createReadStream(localPath);

    const command = new PutObjectCommand({
        Bucket: process.env.R2_BUCKET_NAME,
        Key: r2Key,
        Body: fileStream,
        ContentType: 'video/mp4'
    });

    await r2.send(command);
    return `${process.env.R2_PUBLIC_DOMAIN}/${r2Key}`;
}

module.exports = { uploadToR2 };
