import { App } from 'aws-cdk-lib';
import { ServicesStack } from './services-stack';

const app = new App();
new ServicesStack(app, 'ServicesStack', {
	githubRepoUrl: 'https://github.com/kevinand11/services-deployment',
	githubRepoBranch: 'main',
	sshKeyName: 'services-deployment'
});
