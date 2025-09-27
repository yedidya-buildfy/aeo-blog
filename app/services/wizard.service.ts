import prisma from "../db.server";

export interface SimpleWizardState {
  shopDomain: string;
  completed: boolean;
  currentStep: 1 | 2 | 3; // 1 = AEO, 2 = Plan, 3 = Complete
  selectedPlan?: 'free' | 'starter' | 'pro';
  startedAt: Date;
  completedAt?: Date;
}

export class WizardService {
  constructor(private shopDomain: string) {}

  async getWizardState(): Promise<SimpleWizardState | null> {
    const state = await prisma.wizardState.findUnique({
      where: { shopDomain: this.shopDomain }
    });

    if (!state) {
      return null;
    }

    return {
      shopDomain: state.shopDomain,
      completed: state.completed,
      currentStep: state.currentStep as 1 | 2 | 3,
      selectedPlan: state.selectedPlan as 'free' | 'starter' | 'pro' | undefined,
      startedAt: state.startedAt,
      completedAt: state.completedAt || undefined
    };
  }

  async shouldShowWizard(): Promise<{ show: boolean; startFromStep: 1 | 2 | 3 }> {
    const state = await this.getWizardState();

    if (!state) {
      // No wizard state exists, show from step 1
      return { show: true, startFromStep: 1 };
    }

    if (state.completed) {
      // Wizard is completed, don't show
      return { show: false, startFromStep: 1 };
    }

    // Wizard is in progress, show from current step
    return { show: true, startFromStep: state.currentStep };
  }

  async startWizard(): Promise<boolean> {
    try {
      await prisma.wizardState.upsert({
        where: { shopDomain: this.shopDomain },
        create: {
          shopDomain: this.shopDomain,
          completed: false,
          currentStep: 1,
          startedAt: new Date()
        },
        update: {
          currentStep: 1,
          completed: false
        }
      });
      return true;
    } catch (error) {
      console.error('Failed to start wizard:', error);
      return false;
    }
  }

  async updateStep(step: 1 | 2 | 3, data?: { selectedPlan?: 'free' | 'starter' | 'pro' }): Promise<boolean> {
    try {
      await prisma.wizardState.upsert({
        where: { shopDomain: this.shopDomain },
        create: {
          shopDomain: this.shopDomain,
          completed: false,
          currentStep: step,
          selectedPlan: data?.selectedPlan,
          startedAt: new Date()
        },
        update: {
          currentStep: step,
          selectedPlan: data?.selectedPlan || undefined
        }
      });
      return true;
    } catch (error) {
      console.error('Failed to update wizard step:', error);
      return false;
    }
  }

  async completeWizard(): Promise<boolean> {
    try {
      await prisma.wizardState.upsert({
        where: { shopDomain: this.shopDomain },
        create: {
          shopDomain: this.shopDomain,
          completed: true,
          currentStep: 3,
          startedAt: new Date(),
          completedAt: new Date()
        },
        update: {
          completed: true,
          currentStep: 3,
          completedAt: new Date()
        }
      });
      return true;
    } catch (error) {
      console.error('Failed to complete wizard:', error);
      return false;
    }
  }

  async selectPlan(plan: 'free' | 'starter' | 'pro'): Promise<boolean> {
    try {
      await prisma.wizardState.upsert({
        where: { shopDomain: this.shopDomain },
        create: {
          shopDomain: this.shopDomain,
          completed: false,
          currentStep: 2,
          selectedPlan: plan,
          startedAt: new Date()
        },
        update: {
          selectedPlan: plan,
          currentStep: 2
        }
      });
      return true;
    } catch (error) {
      console.error('Failed to select plan:', error);
      return false;
    }
  }

  async moveToStep3(): Promise<boolean> {
    return this.updateStep(3);
  }
}