import os from 'os'
import {isClientEnv, isCloudEnv} from './env-helpers'

class MetricsReporter {

  constructor() {
    this._honey = null

    if (isCloudEnv()) {
      const LibHoney = require('libhoney') // eslint-disable-line

      this._honey = new LibHoney({
        writeKey: process.env.HONEY_WRITE_KEY,
        dataset: process.env.HONEY_DATASET,
      })
    }
  }

  async collectCPUUsage() {
    return new Promise((resolve) => {
      const startUsage = process.cpuUsage();
      const sampleDuration = 400;
      setTimeout(() => {
        const {user, system} = process.cpuUsage(startUsage);
        const fractionToPrecent = 100.0;
        resolve(Math.round((user + system) / (sampleDuration * 1000.0) * fractionToPrecent));
      }, sampleDuration);
    });
  }

  async reportEvent(info) {
    if (!info.accountId) {
      throw new Error("Metrics Reporter: You must include an accountId");
    }
    const logger = global.Logger.child({accountEmail: info.emailAddress})
    const {workingSetSize, privateBytes, sharedBytes} = process.getProcessMemoryInfo();
    const percentCPU = await this.collectCPUUsage();

    info.hostname = os.hostname();
    info.cpus = os.cpus().length;
    info.arch = os.arch();
    info.platform = process.platform;
    info.version = NylasEnv.getVersion();
    info.processWorkingSetSize = workingSetSize;
    info.processPrivateBytes = privateBytes;
    info.processSharedBytes = sharedBytes;
    info.processPercentCPU = percentCPU;

    try {
      if (isClientEnv()) {
        const {N1CloudAPI, NylasAPIRequest} = require('nylas-exports') // eslint-disable-line
        const req = new NylasAPIRequest({
          api: N1CloudAPI,
          options: {
            path: `/ingest-metrics`,
            method: 'POST',
            body: info,
            accountId: info.accountId,
          },
        });
        await req.run()
      } else {
        this._honey.sendNow(info);
      }
    } catch (err) {
      logger.log(info, "Metrics Collector: Submitted.", info);
      logger.warn("Metrics Collector: Submission Failed.", {error: err, ...info});
    }
  }
}

export default new MetricsReporter();
