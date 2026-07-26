import { t as tokenIntercept } from './getSSOTokenFromFile-CWJmvcQe.js';
import { g as fileIntercept } from './s3-cache-DBnZf3ob.js';

const externalDataInterceptor = {
    getFileRecord() {
        return fileIntercept;
    },
    interceptFile(path, contents) {
        fileIntercept[path] = Promise.resolve(contents);
    },
    getTokenRecord() {
        return tokenIntercept;
    },
    interceptToken(id, contents) {
        tokenIntercept[id] = contents;
    },
};

export { externalDataInterceptor as e };
