import GLib from 'gi://GLib';
import Soup from 'gi://Soup';

export class ImmichApi {
    constructor(settings) {
        this._settings = settings;
        this._accessToken = null
        this._session = new Soup.Session();
    }

    get(path, body = null, authenticated = true) {
        return this.requestJson(path, "GET", body, authenticated);
    }

    post(path, body = null, authenticated = true) {
        return this.requestJson(path, "POST", body, authenticated);
    }

    getAsBytes(path, body = null, authenticated = true) {
        return this.requestBytes(path, "GET", body, authenticated);
    }

    async requestJson(path, method, body, authenticated) {
        try {
            let bytes = await this.requestBytes(path, method, body, authenticated);
            let data = bytes.get_data();
            if (!data || data.length === 0) {
                console.error('Immich Wallpaper: Empty response from server');
                throw this._error('Empty response from server', 200);
            }
            let responseText = new TextDecoder().decode(data);
            try {
                return JSON.parse(responseText);
            } catch (parseError) {
                console.error(`Immich Wallpaper: Invalid JSON response: ${parseError}`);
                throw new _error('Invalid response from server', 200);
            }
        } catch (e) {
            if(e.code) {
                throw this._error(e.text, e.code);
            } else {
                throw this._error(e);
            }
        }
    }

    requestBytes(path, method, body, authenticated) {
        return new Promise((resolve, reject) => {
            let serverUrl = this.getServerUrl();
        
            let apiUrl = `${serverUrl}/api/${path}`;  
            
            let message;
            try {
                message = Soup.Message.new(method, apiUrl);
                if (!message) {
                    console.error('Immich Wallpaper: Invalid server URL');
                    throw this._error('Invalid server URL');
                }
            } catch (e) {
                console.error(`Immich Wallpaper: Error creating request: ${e}`);
                throw this._error('Invalid server URL format');
            }

            if(body) {
                message.set_request_body_from_bytes(
                    'application/json',
                    new GLib.Bytes(body)
                );
            }

            this._addRequestHeaders(message, authenticated).then(() => {
                this._session.send_and_read_async(
                    message,
                    GLib.PRIORITY_DEFAULT,
                    null,
                    (session, result) => {
                        try {
                            let bytes = session.send_and_read_finish(result);
                            let status = message.get_status();
                            
                            if (status === 200 || status === 201) {
                                resolve(bytes);
                                return;
                            } else {
                                reject(this._error(bytes, status));
                                return;
                            }
                        } catch (e) {
                            reject(this._error(`Error while sending request: ${e}`));
                            return;
                        }
                    }
                );
            }).catch((e) => {
                reject(e);
            });
        });
    }

    async _addRequestHeaders(message, authenticated) {
        if(authenticated) {
            let headers = message.get_request_headers();
            let apiKey = this._settings.get_string('apikey');
            if(apiKey) {
                headers.append('x-api-key', apiKey);
            } else {
                let token = await this._loadAccessToken();
                headers.append('Authorization', `Bearer ${token}`);
            }
        }
    }

    async checkAuthentication() {
        let apiKey = this._settings.get_string('apikey');
        if(apiKey) {
            try {
                await this.get('api-keys/me');
                return;
            } catch (e) {
                throw this._error(`Invalid API Key (${e.text})`, e.code);
            };
        } else {
            try {
                let token = await this._loadAccessToken();
                if(token) {
                    return;
                } else {
                    throw this._error(`Invalid credentials`);
                }
            } catch(e) {
                throw e;
            }
        }
    }

    async _loadAccessToken() {
        if(this._accessToken) {
            return this._accessToken;
        }

        let email = this._settings.get_string('email');
        let password = this._settings.get_string('password');
        let requestBody = JSON.stringify({
            email: email,
            password: password
        });

        try {
            // send an unauthenticated request to retrieve the accesstoken
            let response = await this.post("auth/login", requestBody, false);
            if (!response.accessToken) {
                console.error('Immich Wallpaper: No access token in response');
                throw new Error();
            } else {
                console.log(`Immich Wallpaper: Authentication successful`);
                this._accessToken = response.accessToken;
                return this._accessToken;
            }
        } catch (e) {
            if (e.code === 401) {
                console.error('Immich Wallpaper: Invalid credentials');
            } else if (e.code === 0) {
                console.error('Immich Wallpaper: Could not connect to server');
            } else {
                console.error(`Immich Wallpaper: Authentication error ${e.code}: ${e.text}`);
            }
            throw e;
        }
    }

    getServerUrl() {
        let serverUrl = this._settings.get_string('server-url');        
        if (serverUrl.endsWith('/')) {
            serverUrl = serverUrl.slice(0, -1);
        }
        return serverUrl;
    }

    checkConfiguration() {
        let serverUrl = this._settings.get_string('server-url');
        let email = this._settings.get_string('email');
        let password = this._settings.get_string('password');
        let apiKey = this._settings.get_string('apikey');

        return (serverUrl && ((email && password) || apiKey));
    }

    _error(text, code = null) {
        return {
            text: text,
            code: code
        };
    }
}