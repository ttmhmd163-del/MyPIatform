(function () {
    const projectUrl = 'https://smoejurkljbbphcrheyk.supabase.co';
    const publishableKey = 'sb_publishable_dB2yhl2wvVGhnV6uc7Gbpg_OhcZlCfA';
    const sdkUrl = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2';

    function loadSdk() {
        if (window.supabase && typeof window.supabase.createClient === 'function') {
            return Promise.resolve(window.supabase);
        }

        return new Promise((resolve, reject) => {
            const script = document.createElement('script');
            script.src = sdkUrl;
            script.async = true;
            script.onload = () => {
                if (!window.supabase || typeof window.supabase.createClient !== 'function') {
                    reject(new Error('تعذر تحميل مكتبة Supabase.'));
                    return;
                }
                resolve(window.supabase);
            };
            script.onerror = () => reject(new Error('تعذر الاتصال بمكتبة Supabase عبر CDN.'));
            document.head.append(script);
        });
    }

    window.PlatformSupabase = Object.freeze({
        ready: loadSdk().then((sdk) => sdk.createClient(projectUrl, publishableKey, {
            auth: {
                persistSession: true,
                autoRefreshToken: true,
                detectSessionInUrl: true,
                storageKey: 'myplatform.supabase.auth.v1'
            }
        }))
    });
})();
