class NoAuthSigner {
    async sign(httpRequest, identity, signingProperties) {
        return httpRequest;
    }
}

var version = "3.997.32";
var packageInfo = {
	version: version};

export { NoAuthSigner as N, packageInfo as p };
