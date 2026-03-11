export function injectGenaicodeScript(
  html: string,
  options: {
    genaicodePort: number;
    appContextEnabled?: boolean;
    token?: string;
    logBufferMaxSize: number;
  },
) {
  const { genaicodePort, appContextEnabled, token, logBufferMaxSize } = options;

  return html.replace(
    '</body>',
    `<script type="module" 
  src="/vite-genaicode.js" 
  data-genaicode-port="${genaicodePort}" 
  ${
    appContextEnabled
      ? `data-genaicode-token="${token || ''}"
    data-genaicode-app-context-enabled="true"
    data-genaicode-log-buffer-max-size="${logBufferMaxSize}"`
      : ``
  }          
>
</script>`,
  );
}
