const { parentPort } = require('worker_threads');

// 这里假设消息结构与 TypeScript 端一致，实际可根据 Message 类型调整
parentPort.on('message', async (data) => {
  try {
    const { message } = data;
    // 动态引入 message-handler，调用 processMessage
    // 注意：worker 线程中需避免循环依赖
    const { MessageHandler } = require('./message-handler');
    const handler = MessageHandler.getInstance();
    await handler.processMessage(message);
    parentPort.postMessage({ success: true });
  } catch (error) {
    parentPort.postMessage({ success: false, error: error.message });
  }
}); 