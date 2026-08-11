package com.moontv.tv

import android.annotation.SuppressLint
import android.annotation.TargetApi
import android.app.Activity
import android.content.Context
import android.graphics.Color
import android.os.Build
import android.os.Bundle
import android.util.Log
import android.text.InputType
import android.text.method.PasswordTransformationMethod
import android.view.KeyEvent
import android.view.View
import android.view.ViewGroup
import android.webkit.ConsoleMessage
import android.webkit.CookieManager
import android.webkit.RenderProcessGoneDetail
import android.webkit.WebChromeClient
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Button
import android.widget.EditText
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.TextView
import org.json.JSONObject

/**
 * DreamTV on Google TV: a WebView pointed at your own DreamTV instance.
 *
 * Everything the app does lives in the web app already. This exists only to get an
 * icon on the TV launcher, keep the login cookie, and make the remote work.
 */
class MainActivity : Activity() {

    private var web: WebView? = null

    // Fullscreen <video> support (ArtPlayer's native fullscreen button)
    private var customView: View? = null
    private var customViewCallback: WebChromeClient.CustomViewCallback? = null

    private val prefs by lazy { getSharedPreferences(PREFS, Context.MODE_PRIVATE) }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val url = prefs.getString(KEY_URL, null)?.takeIf { it.isNotBlank() } ?: DEFAULT_URL
        showWeb(url)
    }

    // ---------------------------------------------------------------- setup screen

    /** Shown on first run, on a failed load, and on MENU. [prefill] keeps a bad URL editable. */
    private fun showSetup(prefill: String?, error: String? = null) {
        web = null
        val pad = dp(32)

        val input = EditText(this).apply {
            inputType = InputType.TYPE_TEXT_VARIATION_URI
            setSingleLine()
            setText(prefill ?: prefs.getString(KEY_URL, null) ?: DEFAULT_URL)
            hint = "https://dreamtv.example.com"
            // The stock EditText background is light, so the text must be dark to be readable.
            setTextColor(Color.BLACK)
            setHintTextColor(Color.DKGRAY)
            textSize = 20f
        }

        // Typed once, here, instead of on the web login form every time the cookie lapses.
        // The site keeps its password — this box just knows it, so the TV never asks again.
        val pass = EditText(this).apply {
            setSingleLine()
            // 必须放在 setSingleLine() 之后：setSingleLine 会重置 transformationMethod，
            // 先设 inputType 的话密码会明晃晃地显示在电视上给一屋子人看。
            inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_PASSWORD
            transformationMethod = PasswordTransformationMethod.getInstance()
            setText(prefs.getString(KEY_PASS, "") ?: "")
            hint = "site password"
            setTextColor(Color.BLACK)
            setHintTextColor(Color.DKGRAY)
            textSize = 20f
        }

        val save = Button(this).apply {
            text = "Save"
            setOnClickListener {
                val entered = normalizeUrl(input.text.toString())
                if (entered == null) {
                    showSetup(input.text.toString(), "Enter a server address first")
                } else {
                    prefs.edit()
                        .putString(KEY_URL, entered)
                        .putString(KEY_PASS, pass.text.toString())
                        .apply()
                    showWeb(entered)
                }
            }
        }

        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(Color.BLACK)
            setPadding(pad, pad, pad, pad)
            addView(label("DreamTV server address", dp(28)))
            if (error != null) addView(label(error, dp(18), Color.RED))
            addView(input)
            addView(pass)
            addView(save)
            addView(label("Change them later with the MENU button.", dp(14), Color.GRAY))
        }
        setContentView(root)
        input.requestFocus()
    }

    private fun label(text: String, sizePx: Int, color: Int = Color.WHITE) =
        TextView(this).apply {
            this.text = text
            setTextColor(color)
            setTextSize(android.util.TypedValue.COMPLEX_UNIT_PX, sizePx.toFloat())
            setPadding(0, dp(8), 0, dp(8))
        }

    /** "" -> null, "host" -> "https://host", anything with a scheme is left alone. */
    private fun normalizeUrl(raw: String): String? {
        val t = raw.trim().trimEnd('/')
        if (t.isEmpty()) return null
        return if (t.startsWith("http://") || t.startsWith("https://")) t else "https://$t"
    }

    // ---------------------------------------------------------------- the web view

    @SuppressLint("SetJavaScriptEnabled")
    private fun showWeb(url: String) {
        val w = WebView(this)
        w.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            mediaPlaybackRequiresUserGesture = false
            loadWithOverviewMode = true
            useWideViewPort = true
            mixedContentMode = WebSettings.MIXED_CONTENT_COMPATIBILITY_MODE
            // Tune this if text is too small/large on your TV — it is the whole
            // 10-foot readability fix, no CSS changes needed on the web side.
            textZoom = TEXT_ZOOM
            userAgentString = "$userAgentString MoonTV-TV"
        }

        w.webViewClient = object : WebViewClient() {
            /**
             * The renderer process died — almost always the OS reclaiming memory on a 2GB TV box
             * while hls.js is buffering. Returning true says "handled"; without this override
             * Android kills the whole app and the user is dumped back to the launcher.
             * Rebuild the WebView and reload instead.
             */
            @TargetApi(Build.VERSION_CODES.O)
            override fun onRenderProcessGone(
                view: WebView,
                detail: RenderProcessGoneDetail
            ): Boolean {
                (view.parent as? ViewGroup)?.removeView(view)
                view.destroy()
                if (web === view) {
                    showWeb(prefs.getString(KEY_URL, null)?.takeIf { it.isNotBlank() } ?: DEFAULT_URL)
                }
                return true
            }

            override fun onPageFinished(view: WebView, url: String) {
                // Re-injected per navigation; the script no-ops if it is already installed.
                view.evaluateJavascript(TV_NAV_JS, null)

                // Landed on the login form: log in for the user and carry on to where they
                // were headed. Nobody wants to peck a password out on a d-pad, and this is
                // a private box — the credential lives on the TV, not a hole in the server.
                val pw = prefs.getString(KEY_PASS, null)
                if (url.contains("/login") && !pw.isNullOrBlank()) {
                    view.evaluateJavascript(autoLoginJs(pw), null)
                }
            }

            override fun onReceivedError(
                view: WebView, request: WebResourceRequest, error: WebResourceError
            ) {
                // Only the main document matters; a failed poster image is not a dead app.
                if (!request.isForMainFrame) return
                showSetup(url, "Could not reach $url")
            }
        }

        w.webChromeClient = object : WebChromeClient() {
            // 把网页的 console 转发到 logcat：真机上没有 devtools，这是唯一能看到页面日志的地方
            override fun onConsoleMessage(m: ConsoleMessage): Boolean {
                Log.d("MoonTVWeb", "${m.message()} @${m.sourceId()}:${m.lineNumber()}")
                return true
            }

            override fun onShowCustomView(view: View, callback: CustomViewCallback) {
                if (customView != null) { callback.onCustomViewHidden(); return }
                customView = view
                customViewCallback = callback
                (window.decorView as FrameLayout).addView(
                    view,
                    FrameLayout.LayoutParams(
                        ViewGroup.LayoutParams.MATCH_PARENT,
                        ViewGroup.LayoutParams.MATCH_PARENT
                    )
                )
            }

            override fun onHideCustomView() {
                val view = customView ?: return
                (window.decorView as FrameLayout).removeView(view)
                customView = null
                customViewCallback?.onCustomViewHidden()
                customViewCallback = null
            }
        }

        CookieManager.getInstance().apply {
            setAcceptCookie(true)
            setAcceptThirdPartyCookies(w, true)
        }

        web = w
        setContentView(w)
        w.requestFocus()
        w.loadUrl(url)
    }

    // ---------------------------------------------------------------- remote keys

    override fun onKeyDown(keyCode: Int, event: KeyEvent): Boolean {
        val w = web
        when (keyCode) {
            KeyEvent.KEYCODE_BACK -> {
                if (customView != null) { w?.webChromeClient?.onHideCustomView(); return true }
                if (w != null) {
                    // 指南：左侧导航的应用，返回键先把焦点收回导航，再按才后退/退出。
                    // 页面自己判断（焦点是否已在导航里），结果异步回来后再决定。
                    w.evaluateJavascript("(window.__tvBack && window.__tvBack())") { result ->
                        if (result != "true") {
                            if (w.canGoBack()) w.goBack() else finish()
                        }
                    }
                    return true
                }
            }
            KeyEvent.KEYCODE_MENU -> {
                showSetup(prefs.getString(KEY_URL, null) ?: DEFAULT_URL); return true
            }
        }
        return super.onKeyDown(keyCode, event)
    }

    // ---------------------------------------------------------------- lifecycle

    override fun onPause() {
        super.onPause()
        web?.onPause()
        // Without this the login cookie is lost when the TV kills the app.
        CookieManager.getInstance().flush()
    }

    override fun onResume() {
        super.onResume()
        web?.onResume()
    }

    private fun dp(v: Int) = (v * resources.displayMetrics.density).toInt()

    /**
     * Posts the saved password to /api/login (which sits outside the auth middleware) and
     * continues to the page the user was originally after. A wrong password falls through
     * and leaves the normal login form on screen, so a typo is still recoverable.
     */
    private fun autoLoginJs(password: String) = """
        (function () {
          if (window.__tvAutoLogin) return;
          window.__tvAutoLogin = 1;
          fetch('/api/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ password: ${JSONObject.quote(password)} })
          }).then(function (r) {
            if (!r.ok) { window.__tvAutoLogin = 0; return; }
            var to = new URLSearchParams(location.search).get('redirect') || '/';
            location.replace(to);
          }).catch(function () { window.__tvAutoLogin = 0; });
        })();
    """

    companion object {
        private const val PREFS = "moontv"
        private const val KEY_URL = "url"
        private const val KEY_PASS = "password"

        /**
         * Where the app goes on a fresh install. Typing a URL on a remote is miserable and
         * this build only ever points at one instance, so first run goes straight to it.
         * The setup screen is still reachable via MENU and still shows up when a load fails.
         */
        private const val DEFAULT_URL = "https://movies.recursivedreamlabs.com"
        private const val TEXT_ZOOM = 130
    }
}
