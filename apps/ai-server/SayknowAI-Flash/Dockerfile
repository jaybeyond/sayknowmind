# Ollama with Qwen3-0.6B (Flash - 빠름) - v10
FROM ollama/ollama

# Create startup script with model preload
RUN echo '#!/bin/bash\n\
set -e\n\
\n\
# 환경변수 설정 (모델 영구 유지)\n\
export OLLAMA_KEEP_ALIVE=-1\n\
export OLLAMA_NUM_PARALLEL=8\n\
export OLLAMA_HOST=0.0.0.0\n\
\n\
echo "Starting Ollama with KEEP_ALIVE=-1 (permanent)..."\n\
ollama serve &\n\
OLLAMA_PID=$!\n\
\n\
echo "Waiting for Ollama to start..."\n\
for i in {1..30}; do\n\
  if curl -s http://localhost:11434/api/tags > /dev/null 2>&1; then\n\
    echo "Ollama is ready!"\n\
    break\n\
  fi\n\
  sleep 2\n\
done\n\
\n\
MODEL_NAME="qwen3:0.6b"\n\
\n\
if ! ollama list | grep -q "$MODEL_NAME"; then\n\
  echo "Downloading $MODEL_NAME model..."\n\
  ollama pull $MODEL_NAME\n\
  echo "Model download complete!"\n\
else\n\
  echo "Model $MODEL_NAME already exists"\n\
fi\n\
\n\
echo "Preloading model into memory with num_ctx=4096..."\n\
curl -s -X POST http://localhost:11434/api/chat \\\n\
  -H "Content-Type: application/json" \\\n\
  -d "{\"model\":\"$MODEL_NAME\",\"messages\":[{\"role\":\"user\",\"content\":\"hi\"}],\"stream\":false,\"options\":{\"num_ctx\":4096,\"num_predict\":1},\"keep_alive\":-1}" \\\n\
  > /dev/null 2>&1 || true\n\
echo "Model preloaded and will stay in memory permanently!"\n\
\n\
wait $OLLAMA_PID\n\
' > /start.sh && chmod +x /start.sh

ENV OLLAMA_HOST=0.0.0.0
ENV OLLAMA_KEEP_ALIVE=-1
ENV OLLAMA_NUM_PARALLEL=8
EXPOSE 11434

ENTRYPOINT []
CMD ["/bin/bash", "/start.sh"]
