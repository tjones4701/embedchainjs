import { PdfFileChunker } from '../chunkers/PdfFile';
import { EmbedChain } from '../embedchain';
import { BaseLoader } from '../loaders/BaseLoader';
import { QnaPair, LoaderResult, DataType, Metadata } from '../models';

const mockAdd = jest.fn();
const mockAddLocal = jest.fn();
const mockQuery = jest.fn();


type CustomDataType = {
  name: string,
  description: number,
}

class CustomLoader extends BaseLoader {
  // eslint-disable-next-line class-methods-use-this
  async loadData(content: CustomDataType, metaData: Metadata | undefined): Promise<LoaderResult> {
    const {name,description} = content;
    const contentText = `Name: ${name}\nDescription: ${description}`;
    
    metaData = metaData ?? {
      url: 'local',      
    }

    return [
      {
        content: contentText,
        metaData,
      },
    ];
  }
}

jest.mock('../embedchain', () => {
  return {
    EmbedChainApp: jest.fn().mockImplementation(() => {
      return {
        add: mockAdd,
        addLocal: mockAddLocal,
        query: mockQuery,
      };
    }),
  };
});

describe('Custom Loader', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('Tests the custom loaders for the embed chaion app', async () => {
    mockQuery.mockResolvedValue(
      'Naval argues that humans possess the unique capacity to understand explanations or concepts to the maximum extent possible in this physical reality.'
    );

    const navalChatBot = await new EmbedChain<"custom">({
      dataTypes: {
        "custom": {
          loader: CustomLoader,
          chunker: PdfFileChunker,
        }
      }
    });

    // Embed Online Resources
    await navalChatBot.add("custom", {});
    const result = await navalChatBot.query(
      'What unique capacity does Naval argue humans possess when it comes to understanding explanations or concepts?'
    );

    expect(mockAdd).toHaveBeenCalledWith('custom', 'https://nav.al/feedback');
    expect(mockAdd).toHaveBeenCalledWith('web_page', 'https://nav.al/agi');
    expect(mockAdd).toHaveBeenCalledWith(
      'pdf_file',
      'https://navalmanack.s3.amazonaws.com/Eric-Jorgenson_The-Almanack-of-Naval-Ravikant_Final.pdf'
    );
    expect(mockAddLocal).toHaveBeenCalledWith('qna_pair', [
      'Who is Naval Ravikant?',
      'Naval Ravikant is an Indian-American entrepreneur and investor.',
    ]);
    expect(mockQuery).toHaveBeenCalledWith(
      'What unique capacity does Naval argue humans possess when it comes to understanding explanations or concepts?'
    );
    expect(result).toBe(
      'Naval argues that humans possess the unique capacity to understand explanations or concepts to the maximum extent possible in this physical reality.'
    );
  });
});
