import { Construct } from 'constructs';
import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecr from 'aws-cdk-lib/aws-ecr';
import * as iam from 'aws-cdk-lib/aws-iam';
/* import * as route53 from 'aws-cdk-lib/aws-route53';
import * as targets from 'aws-cdk-lib/aws-route53-targets'; */

interface ServicesStackProps extends cdk.StackProps {
  managementServiceRepositoryName: string;
  // domainName: string;
  sshKeyName: string;
}

export class ServicesStack extends cdk.Stack {
  managementServiceRepo: ecr.IRepository
  constructor(scope: Construct, id: string, public props: ServicesStackProps) {
    super(scope, id, props);

    this.managementServiceRepo = ecr.Repository.fromRepositoryName(this, 'ManagementServiceRepository', this.props.managementServiceRepositoryName)

    const { instance } = this.createInstance()

    new cdk.CfnOutput(this, 'ServiceInstanceId', {
      value: instance.instanceId,
      description: 'Instance ID of the services host'
    });

    new cdk.CfnOutput(this, 'ServicePublicIP', {
      value: instance.instancePublicIp,
      description: 'Public IP of the services host'
    });
  }

  createInstance() {
    const vpc = ec2.Vpc.fromLookup(this, 'VPC', {
      isDefault: true
    });

    const securityGroup = new ec2.SecurityGroup(this, 'ServiceSecurityGroup', {
      vpc,
      description: 'Security group for services deployment',
      allowAllOutbound: true
    });

    securityGroup.addIngressRule(
      ec2.Peer.anyIpv4(),
      ec2.Port.tcp(22),
      'Allow SSH access'
    );
    securityGroup.addIngressRule(
      ec2.Peer.anyIpv4(),
      ec2.Port.tcp(80),
      'Allow HTTP traffic'
    );
    securityGroup.addIngressRule(
      ec2.Peer.anyIpv4(),
      ec2.Port.tcp(443),
      'Allow HTTPS traffic'
    );

    const instanceRole = new iam.Role(this, 'ServiceInstanceRole', {
      assumedBy: new iam.ServicePrincipal('ec2.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('AmazonSSMManagedInstanceCore'),
        iam.ManagedPolicy.fromAwsManagedPolicyName('CloudWatchLogsFullAccess')
      ]
    });

    const userData = ec2.UserData.forLinux();
    userData.addCommands(
      // System Update
      'dnf update -y',
      'dnf install -y docker docker-compose-plugin git',

      // Configure AWS CLI and ECR login
      'dnf install -y awscli',
      'aws configure set region $(curl -s http://169.254.169.254/latest/meta-data/placement/region)',

      // Enable Docker
      'systemctl enable docker',
      'systemctl start docker',

      // Create Services Directory
      'mkdir -p /opt/services/management',
      'mkdir -p /opt/services/configs',
      'mkdir -p /opt/services/scripts',

      // Create Pull and Restart Script
      'cat > /opt/services/scripts/pull-and-restart-management-service.sh << EOL',
      '#!/bin/bash',
      'set -e',

      // Authenticate Docker to ECR
      'aws ecr get-login-password --region $(aws configure get region) | docker login --username AWS --password-stdin $(aws sts get-caller-identity --query Account --output text).dkr.ecr.$(aws configure get region).amazonaws.com',

      // Stop existing service
      'systemctl stop services-management || true',

      // Pull latest image
      `docker pull ${this.managementServiceRepo.repositoryUri}:latest`,

      // Remove existing container if exists
      'docker rm -f management-service || true',

      // Run new container
      `docker run -d --name management-service \\
        -p 3000:3000 \\
        -v /opt/services/configs:/opt/services/configs \\
        ${this.managementServiceRepo.repositoryUri}:latest`,

      // Create systemd service for management
      'cat > /etc/systemd/system/services-management.service << INNEREOF',
      '[Unit]',
      'Description=Services Management Service',
      'After=docker.service',
      'Requires=docker.service',
      '[Service]',
      'Type=simple',
      'ExecStart=/usr/bin/docker start -a management-service',
      'ExecStop=/usr/bin/docker stop management-service',
      'Restart=always',
      '[Install]',
      'WantedBy=multi-user.target',
      'INNEREOF',

      // Reload and Start Services
      'systemctl daemon-reload',
      'systemctl enable services-management',
      'systemctl start services-management',
      'EOL',

      // Make Scripts Executable
      'chmod +x /opt/services/scripts/pull-and-restart-management-service.sh'
    );

    const instance = new ec2.Instance(this, 'ServiceInstance', {
      vpc,
      instanceType: ec2.InstanceType.of(ec2.InstanceClass.T3, ec2.InstanceSize.SMALL),
      machineImage: ec2.MachineImage.latestAmazonLinux2023(),
      securityGroup: securityGroup,
      role: instanceRole,
      keyName: this.props.sshKeyName,
      userData: userData
    });

    /* const hostedZone = route53.HostedZone.fromLookup(this, 'HostedZone', {
      domainName: this.props.domainName
    });

    new route53.ARecord(this, 'ServiceDNSRecord', {
      zone: hostedZone,
      recordName: `services.${props.domainName}`,
      target: route53.RecordTarget.fromIpAddresses(instance.instancePublicIp)
    }); */

    return { instance }
  }
}
