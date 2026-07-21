import { ListObjectsV2Command, type ListObjectsV2CommandOutput } from "@aws-sdk/client-s3";

export interface S3ObjectLister {
  send(command: ListObjectsV2Command): Promise<ListObjectsV2CommandOutput>;
}

export interface S3CacheObject {
  key: string;
  lastModified: Date | undefined;
}

export async function newestObjectForPrefix(
  client: S3ObjectLister,
  bucket: string,
  prefix: string,
): Promise<S3CacheObject | undefined> {
  let newest: S3CacheObject | undefined;
  let continuationToken: string | undefined;

  do {
    const page = await client.send(
      new ListObjectsV2Command({
        Bucket: bucket,
        Prefix: prefix,
        ContinuationToken: continuationToken,
      }),
    );

    for (const object of page.Contents ?? []) {
      if (!object.Key) {
        continue;
      }

      const candidate = { key: object.Key, lastModified: object.LastModified };
      if (!newest || isNewer(candidate, newest)) {
        newest = candidate;
      }
    }

    continuationToken = page.IsTruncated ? page.NextContinuationToken : undefined;
  } while (continuationToken);

  return newest;
}

function isNewer(candidate: S3CacheObject, current: S3CacheObject): boolean {
  const candidateTime = candidate.lastModified?.getTime() ?? 0;
  const currentTime = current.lastModified?.getTime() ?? 0;
  return candidateTime > currentTime || (candidateTime === currentTime && candidate.key < current.key);
}
