import { Controller, Get, NotFoundException, Param, Post, Body } from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';

// Ensure all worker components are registered before accessing the registry
import '@shipsec/studio-worker/components';
import {
  componentRegistry,
  extractPorts,
  isAgentCallable,
  getToolSchema,
  type CachedComponentMetadata,
} from '@shipsec/component-sdk';
import { categorizeComponent, getCategoryConfig } from './utils/categorization';
import { ResolvePortsRequestDto, ResolvePortsResponseDto } from './dto/resolve-ports.dto';
import { ComponentListItemDto, ComponentDetailDto } from './dto/component-response.dto';

function serializeComponent(entry: CachedComponentMetadata) {
  const component = entry.definition;
  const metadata = component.ui ?? {
    slug: component.id,
    version: '1.0.0',
    type: 'process',
    category: 'transform',
  };

  // Categorize the component using the new backend logic
  const category = categorizeComponent(component);
  const categoryConfig = getCategoryConfig(category);

  return {
    id: component.id,
    slug: metadata.slug ?? component.id,
    name: component.label,
    version: metadata.version ?? '1.0.0',
    type: metadata.type ?? 'process',
    category: category,
    categoryConfig: categoryConfig,
    description: metadata.description ?? component.docs ?? '',
    documentation: metadata.documentation ?? component.docs ?? '',
    documentationUrl: metadata.documentationUrl ?? null,
    icon: metadata.icon ?? null,
    logo: metadata.logo ?? null,
    author: metadata.author ?? null,
    isLatest: metadata.isLatest ?? true,
    deprecated: metadata.deprecated ?? false,
    example: metadata.example ?? null,
    runner: component.runner,
    inputs: entry.inputs ?? [],
    outputs: entry.outputs ?? [],
    parameters: entry.parameters ?? [],
    examples: metadata.examples ?? [],
    toolProvider: component.toolProvider ?? null,
    toolSchema: isAgentCallable(component) ? getToolSchema(component) : null,
  };
}

@ApiTags('components')
@Controller('components')
export class ComponentsController {
  @Get()
  @ApiOkResponse({
    description: 'List all registered components',
    type: ComponentListItemDto,
    isArray: true,
  })
  listComponents() {
    const components = componentRegistry.listMetadata();

    return components.map((entry) => serializeComponent(entry));
  }

  @Get(':id')
  @ApiOkResponse({
    description: 'Get a specific component by ID',
    type: ComponentDetailDto,
  })
  getComponent(@Param('id') id: string) {
    const entry = componentRegistry.getMetadata(id);

    if (!entry) {
      throw new NotFoundException(`Component ${id} not found`);
    }

    return serializeComponent(entry);
  }
  @Post(':id/resolve-ports')
  @ApiOkResponse({
    description: 'Resolve dynamic ports based on parameters',
    type: ResolvePortsResponseDto,
  })
  resolvePorts(@Param('id') id: string, @Body() body: ResolvePortsRequestDto) {
    const entry = componentRegistry.getMetadata(id);

    if (!entry) {
      throw new NotFoundException(`Component ${id} not found`);
    }

    const component = entry.definition;
    const baseInputs = entry.inputs ?? extractPorts(component.inputs);
    const baseOutputs = entry.outputs ?? extractPorts(component.outputs);

    if (!component.resolvePorts) {
      // If no dynamic resolver, return static definition
      return {
        inputs: baseInputs,
        outputs: baseOutputs,
      };
    }

    // Call the resolver
    try {
      const resolved = component.resolvePorts(body);
      return {
        inputs: resolved.inputs ? extractPorts(resolved.inputs) : baseInputs,
        outputs: resolved.outputs ? extractPorts(resolved.outputs) : baseOutputs,
      };
    } catch (error: any) {
      // Fallback to static on error
      console.error(`Error resolving ports for ${id}:`, error);
      return {
        inputs: baseInputs,
        outputs: baseOutputs,
      };
    }
  }
}
